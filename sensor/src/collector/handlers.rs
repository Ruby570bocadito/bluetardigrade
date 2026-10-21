// The ETW event handlers: one function per provider callback, each
// decoding its record against the schema and emitting normalized
// events. The PID tables, caches and session tuning they read live in
// `shared` and `config`; everything here is pure decoding and
// filtering.

use crate::dns;
use crate::netreg;
use crate::normalize::{self, EventJson, NetworkJson, ProcessJson, RegistryJson};
use crate::normalize::{TYPE_NETWORK_CONNECT, TYPE_PROCESS_CREATE, TYPE_REGISTRY_SET};
use crate::procinfo;
use ferrisetw::parser::{Parser, Pointer};
use ferrisetw::schema_locator::SchemaLocator;
use ferrisetw::EventRecord;
use std::net::IpAddr;
use std::sync::atomic::Ordering;
use std::time::Instant;

use super::config::{
    DNS_STATUS_INVALID_PARAMETER, EVENT_DNS_QUERY_COMPLETED, EVENT_FILE_CREATE, EVENT_FILE_WRITE, EVENT_KP_PROCESS_START,
    EVENT_REG_CLOSE_KEY, EVENT_REG_CREATE_KEY, EVENT_REG_OPEN_KEY, EVENT_REG_SET_VALUE, EVENT_TCP4_CONNECT,
    EVENT_TCP6_CONNECT, OPCODE_PROCESS_DC_END, OPCODE_PROCESS_DC_START, OPCODE_PROCESS_END, OPCODE_PROCESS_START,
};
use super::shared::Shared;
use super::winimage::image_path;

/// RFC 3339 time of an ETW record (the record's own time, not the
/// processing clock: kernel buffering can delay delivery by seconds).
fn record_time(record: &EventRecord) -> String {
    // decoded from the raw FILETIME: ferrisetw 1.2.0's timestamp()
    // drops the low dword
    procinfo::filetime_to_rfc3339(record.raw_timestamp()).unwrap_or_else(normalize::now_rfc3339)
}

/// Kernel process events: Start becomes a process.create event; Start,
/// End and the rundown keep the PID -> name table current.
pub(super) fn handle_process(record: &EventRecord, schema_locator: &SchemaLocator, ctx: &Shared) {
    let opcode = record.opcode();
    if !matches!(opcode, OPCODE_PROCESS_START | OPCODE_PROCESS_END | OPCODE_PROCESS_DC_START | OPCODE_PROCESS_DC_END) {
        return;
    }
    let Ok(schema) = schema_locator.event_schema(record) else {
        return;
    };
    let parser = Parser::create(record, &schema);
    // ProcessID is the one field every useful event must carry; the
    // rest degrade gracefully (ppid 0 is skipped on serialization,
    // missing CommandLine serializes as absent).
    let Ok(pid) = parser.try_parse::<u32>("ProcessId") else {
        return;
    };
    if opcode == OPCODE_PROCESS_END {
        if let Ok(mut table) = ctx.processes.lock() {
            table.remove(pid);
        }
        return;
    }
    let short_name = parser.try_parse::<String>("ImageFileName").unwrap_or_default();
    let command_line = parser.try_parse::<String>("CommandLine").ok().filter(|c| !c.is_empty());
    // The kernel event has no full image path and argv[0] is
    // caller-controlled: the path comes from the live process, for starts
    // and for the start-up rundown (those processes are running). It is
    // kept only when it matches the kernel's name (a process that already
    // exited may have had its PID reused), and then names the process
    // exactly: the kernel's name is cut at 14 characters.
    // a process that already exited is named by Kernel-Process, when its
    // event came first; otherwise the enrichment thread waits for it
    let verify = |path: String| procinfo::name_from_image(&short_name, &path).map(|name| (path, name));
    let verified = match opcode {
        OPCODE_PROCESS_START => image_path(pid).and_then(verify).or_else(|| ctx.recent_image(pid).and_then(verify)),
        OPCODE_PROCESS_DC_START => image_path(pid).and_then(verify),
        _ => None,
    };
    let (image, name) = match verified {
        Some((path, name)) => (Some(path), name),
        None => (None, procinfo::process_name(&short_name, command_line.as_deref().unwrap_or(""))),
    };
    // owner of the process (the kernel's WBEM SID), not the account
    // that runs the sensor; starts and the rundown both carry it (the
    // rundown covers the processes already running, whose registry
    // writes the netreg session still reports)
    let user = parser.try_parse::<Vec<u8>>("UserSID").ok().and_then(|b| procinfo::sid_from_wbem(&b));
    if let Ok(mut table) = ctx.processes.lock() {
        table.insert(pid, name.clone(), user.clone());
    }
    if opcode != OPCODE_PROCESS_START {
        return; // rundown: names only, these processes did not just start
    }
    let ppid = parser.try_parse::<u32>("ParentId").unwrap_or(0);
    let event = EventJson {
        id: normalize::new_uuid(),
        timestamp: record_time(record),
        r#type: TYPE_PROCESS_CREATE.into(),
        source: "etw".into(),
        host: ctx.host.clone(),
        user,
        process: Some(ProcessJson {
            pid: pid as i32,
            ppid: ppid as i32,
            name,
            command_line,
            image: image.clone(),
            hashes: None, // filled by the enrichment thread
        }),
        network: None,
        registry: None,
        file: None,
        attributes: None,
        tags: vec!["sensor:etw".into()],
    };
    ctx.emit_enriched(event, image, pid, short_name);
}

/// Kernel-Process ProcessStart: remembers the image of every new process,
/// for the ones that exit before the kernel trace's event is handled.
pub(super) fn handle_process_image(record: &EventRecord, schema_locator: &SchemaLocator, ctx: &Shared) {
    if record.event_id() != EVENT_KP_PROCESS_START {
        return;
    }
    let Ok(schema) = schema_locator.event_schema(record) else {
        return;
    };
    let parser = Parser::create(record, &schema);
    let (Ok(pid), Ok(nt)) = (parser.try_parse::<u32>("ProcessID"), parser.try_parse::<String>("ImageName")) else {
        return;
    };
    if let Some(path) = ctx.devices.to_dos(&nt) {
        if let Ok(mut images) = ctx.images.lock() {
            images.insert(pid, path, Instant::now());
        }
    }
}

/// Kernel-Network TCP connection attempts -> network.connect.
pub(super) fn handle_network(record: &EventRecord, schema_locator: &SchemaLocator, ctx: &Shared) {
    if !matches!(record.event_id(), EVENT_TCP4_CONNECT | EVENT_TCP6_CONNECT) {
        return;
    }
    let Ok(schema) = schema_locator.event_schema(record) else {
        return;
    };
    let parser = Parser::create(record, &schema);
    let Ok(daddr) = parser.try_parse::<IpAddr>("daddr") else {
        return;
    };
    if netreg::is_loopback(&daddr) {
        return;
    }
    // the event's own PID field: the header PID can be System's
    let pid = parser.try_parse::<u32>("PID").unwrap_or_else(|_| record.process_id());
    if pid == ctx.own_pid {
        return;
    }
    let saddr = parser.try_parse::<IpAddr>("saddr").ok();
    let dport = parser.try_parse::<u16>("dport").map(netreg::port_from_wire).unwrap_or(0);
    let sport = parser.try_parse::<u16>("sport").map(netreg::port_from_wire).unwrap_or(0);
    ctx.emit(&EventJson {
        id: normalize::new_uuid(),
        timestamp: record_time(record),
        r#type: TYPE_NETWORK_CONNECT.into(),
        source: "etw".into(),
        host: ctx.host.clone(),
        user: None,
        process: Some(ProcessJson {
            pid: pid as i32,
            ppid: 0,
            name: ctx.process_name(pid),
            command_line: None,
            image: None,
            hashes: None,
        }),
        network: Some(NetworkJson {
            protocol: Some("tcp".into()),
            source_ip: saddr.map(|ip| ip.to_string()),
            source_port: sport as i32,
            destination_ip: daddr.to_string(),
            destination_port: dport as i32,
            // the name this address was resolved from, when the lookup
            // went through the DNS client shortly before
            domain: ctx.domain_for(&daddr),
        }),
        registry: None,
        file: None,
        attributes: None,
        tags: vec!["sensor:etw".into()],
    });
}

/// DNS-Client "query completed" -> network.connect with protocol dns.
pub(super) fn handle_dns(record: &EventRecord, schema_locator: &SchemaLocator, ctx: &Shared) {
    if record.event_id() != EVENT_DNS_QUERY_COMPLETED {
        return;
    }
    let pid = record.process_id();
    if pid == ctx.own_pid {
        return;
    }
    let Ok(schema) = schema_locator.event_schema(record) else {
        return;
    };
    let parser = Parser::create(record, &schema);
    let Some(name) = parser.try_parse::<String>("QueryName").ok().and_then(|raw| dns::query_name(&raw)) else {
        return;
    };
    let status = parser.try_parse::<u32>("QueryStatus").ok();
    if status == Some(DNS_STATUS_INVALID_PARAMETER) {
        return; // the unanswered first report of a query; the result follows
    }
    let results = parser.try_parse::<String>("QueryResults").unwrap_or_default();
    let ips = dns::answer_ips(&results);
    let forward = match ctx.dns.lock() {
        Ok(mut st) => st.observe(pid, &name, &ips, Instant::now()),
        Err(_) => true,
    };
    if !forward {
        return;
    }
    let mut attributes = std::collections::BTreeMap::new();
    if let Ok(qtype) = parser.try_parse::<u32>("QueryType") {
        attributes.insert("dns_query_type".to_string(), qtype.to_string());
    }
    if let Some(status) = status {
        // 0 answered, 9003 name does not exist, 1460 timeout...
        attributes.insert("dns_status".to_string(), status.to_string());
    }
    ctx.emit(&EventJson {
        id: normalize::new_uuid(),
        timestamp: record_time(record),
        r#type: TYPE_NETWORK_CONNECT.into(),
        source: "etw".into(),
        host: ctx.host.clone(),
        user: None,
        process: Some(ProcessJson {
            pid: pid as i32,
            ppid: 0,
            name: ctx.process_name(pid),
            command_line: None,
            image: None,
            hashes: None,
        }),
        network: Some(NetworkJson {
            protocol: Some("dns".into()),
            source_ip: None,
            source_port: 0,
            // first answer, like the Sysmon sensor's first A record
            destination_ip: ips.first().map(|ip| ip.to_string()).unwrap_or_default(),
            destination_port: 0,
            domain: Some(name),
        }),
        registry: None,
        file: None,
        attributes: (!attributes.is_empty()).then_some(attributes),
        tags: vec!["sensor:etw".into()],
    });
}

/// Kernel-File: Create (12) names a file object; Write (16) says bytes
/// landed on one. Together they are the "file written" signal the YARA
/// scanner (S-2) scans: the write hands the Win32 path to the worker
/// through a bounded channel. A write whose object was opened before the
/// session started (or on a device the sensor cannot map to a drive) is
/// skipped rather than guessed, and a write the worker cannot take is
/// counted (yara_dropped), never blocked on: this runs in an ETW callback.
pub(super) fn handle_file(record: &EventRecord, schema_locator: &SchemaLocator, ctx: &Shared) {
    let id = record.event_id();
    if !matches!(id, EVENT_FILE_CREATE | EVENT_FILE_WRITE) {
        return;
    }
    let Ok(schema) = schema_locator.event_schema(record) else {
        return;
    };
    let parser = Parser::create(record, &schema);
    let pointer = |name: &str| parser.try_parse::<Pointer>(name).map(|p| *p).unwrap_or(0);
    if id == EVENT_FILE_CREATE {
        let file_object = pointer("FileObject");
        let name = parser.try_parse::<String>("FileName").unwrap_or_default();
        let name = name.trim_matches(char::from(0)).trim();
        if let Ok(mut names) = ctx.filenames.lock() {
            names.opened(file_object, name.to_string());
        }
        return;
    }
    // Write: name the object, map the NT device path to its drive, and
    // hand the file to the scanner (unless it is the sensor's own).
    let Some((config, stats)) = ctx.yara_config.as_ref().zip(ctx.yara_stats.as_ref()) else {
        return; // no scanner on this run (the session should not be either)
    };
    let file_object = pointer("FileObject");
    let nt_name = ctx.filenames.lock().ok().and_then(|names| names.name_of(file_object).map(str::to_string));
    let Some(nt_name) = nt_name else {
        return; // opened before the session started: no name, no scan
    };
    let Some(path) = ctx.devices.to_dos(&nt_name) else {
        return; // a volume the sensor could not map to a drive letter
    };
    if crate::yara::is_excluded(&path, &config.exclude) {
        return;
    }
    let handed = match ctx.yara.lock() {
        Ok(guard) => match guard.as_ref() {
            Some(tx) => tx.try_send(path).is_ok(),
            None => false,
        },
        Err(_) => false,
    };
    if !handed {
        stats.dropped.fetch_add(1, Ordering::Relaxed);
    }
}

/// Kernel-Registry: OpenKey/CreateKey/CloseKey name the key handles, and
/// SetValueKey on a detection-relevant key becomes registry.set. The
/// write event carries no key name on current Windows: the key comes from
/// the handle's open (or, for a handle opened before the sensor started,
/// from its close, which the write waits for).
pub(super) fn handle_registry(record: &EventRecord, schema_locator: &SchemaLocator, ctx: &Shared) {
    let id = record.event_id();
    if !matches!(id, EVENT_REG_CREATE_KEY | EVENT_REG_OPEN_KEY | EVENT_REG_SET_VALUE | EVENT_REG_CLOSE_KEY) {
        return;
    }
    let Ok(schema) = schema_locator.event_schema(record) else {
        return;
    };
    let parser = Parser::create(record, &schema);
    let pointer = |name: &str| parser.try_parse::<Pointer>(name).map(|p| *p).unwrap_or(0);
    let now = Instant::now();
    match id {
        EVENT_REG_CREATE_KEY | EVENT_REG_OPEN_KEY => {
            if parser.try_parse::<u32>("Status").is_ok_and(|status| status != 0) {
                return;
            }
            let key_object = pointer("KeyObject");
            let base_object = pointer("BaseObject");
            let base_name = parser.try_parse::<String>("BaseName").unwrap_or_default();
            let relative = parser.try_parse::<String>("RelativeName").unwrap_or_default();
            if let Ok(mut names) = ctx.regkeys.lock() {
                names.opened(key_object, base_object, &base_name, &relative);
                if let Some((fragment, watched)) = &ctx.debug_registry {
                    let named = names.name_of(key_object).unwrap_or("");
                    if named.to_ascii_lowercase().contains(fragment.as_str()) || relative.to_ascii_lowercase().contains(fragment.as_str()) {
                        eprintln!("[REG] {} obj={key_object:#x} base={base_object:#x} base_name=[{base_name}] relative=[{relative}] -> [{named}]", if id == EVENT_REG_OPEN_KEY { "open" } else { "create" });
                        if let Ok(mut w) = watched.lock() {
                            w.insert(key_object);
                        }
                    }
                }
            }
        }
        EVENT_REG_CLOSE_KEY => {
            let key_object = pointer("KeyObject");
            let key_name = parser.try_parse::<String>("KeyName").unwrap_or_default();
            if let Some((_, watched)) = &ctx.debug_registry {
                if watched.lock().is_ok_and(|mut w| w.remove(&key_object)) {
                    eprintln!("[REG] close obj={key_object:#x} key_name=[{key_name}]");
                }
            }
            let named = ctx.regkeys.lock().map(|mut names| names.closed(key_object, &key_name)).unwrap_or_default();
            for (event, kernel_key) in named {
                finish_registry(ctx, event, &kernel_key);
            }
        }
        _ => {
            // only writes that succeeded changed the registry
            if parser.try_parse::<u32>("Status").is_ok_and(|status| status != 0) {
                return;
            }
            let pid = record.process_id();
            if pid == ctx.own_pid {
                return;
            }
            let key_object = pointer("KeyObject");
            let key_name = parser.try_parse::<String>("KeyName").unwrap_or_default();
            let value_name = parser.try_parse::<String>("ValueName").unwrap_or_default();
            // The provider's template prefixes the data (stable since
            // Windows 7): DataSize is the value's real size and
            // CapturedDataSize how many bytes the event carries, so a
            // capture of zero means the data did not make it into the
            // event — no value is invented from an empty capture.
            let reg_type = parser.try_parse::<u32>("Type").ok();
            let data_size = parser.try_parse::<u32>("DataSize").ok();
            let captured_size = parser.try_parse::<u16>("CapturedDataSize").ok();
            let captured = parser.try_parse::<Vec<u8>>("CapturedData").ok();
            let captured_len = captured.as_ref().map(Vec::len);
            let value = match (reg_type, captured_size, captured) {
                (Some(_), Some(0), _) => None,
                (Some(reg_type), _, Some(data)) => netreg::registry_value(reg_type, &data),
                _ => None,
            };
            let known = if !key_name.trim_matches(char::from(0)).trim().is_empty() {
                Some(key_name.clone())
            } else {
                ctx.regkeys.lock().ok().and_then(|names| names.name_of(key_object).map(str::to_string))
            };
            if let Some((fragment, watched)) = &ctx.debug_registry {
                let hit = watched.lock().is_ok_and(|w| w.contains(&key_object))
                    || known.as_deref().is_some_and(|k| k.to_ascii_lowercase().contains(fragment.as_str()));
                if hit {
                    eprintln!(
                        "[REG] set pid={pid} obj={key_object:#x} key_name=[{key_name}] resolved=[{}] value_name=[{value_name}] type={reg_type:?} data_size={data_size:?} captured={captured_len:?} value=[{value:?}]",
                        known.as_deref().unwrap_or("(waits for close)"),
                    );
                }
            }
            let event = EventJson {
                id: normalize::new_uuid(),
                timestamp: record_time(record),
                r#type: TYPE_REGISTRY_SET.into(),
                source: "etw".into(),
                host: ctx.host.clone(),
                user: None,
                process: Some(ProcessJson {
                    pid: pid as i32,
                    ppid: 0,
                    name: ctx.process_name(pid),
                    command_line: None,
                    image: None,
                    hashes: None,
                }),
                network: None,
                registry: Some(RegistryJson {
                    key: String::new(), // filled once the key is named
                    value_name: (!value_name.is_empty()).then_some(value_name),
                    value,
                    operation: "SetValue".into(),
                }),
                file: None,
                attributes: None,
                tags: vec!["sensor:etw".into()],
            };
            match known {
                Some(kernel_key) => finish_registry(ctx, event, &kernel_key),
                None => {
                    if let Ok(mut names) = ctx.regkeys.lock() {
                        names.park(key_object, event, now);
                    }
                }
            }
        }
    }
    // writes whose handle was not closed in time: without a key they
    // cannot pass the filter; --registry-all forwards them as they are
    // (with the writer's user, when it is known)
    let expired = ctx.regkeys.lock().map(|mut names| names.expire(now)).unwrap_or_default();
    if ctx.registry_all {
        for mut event in expired {
            if event.user.is_none() {
                if let Some(process) = &event.process {
                    event.user = ctx.process_user(process.pid as u32);
                }
            }
            ctx.emit(&event);
        }
    }
}

/// Names a registry write's key (kernel path -> HKLM/HKU form) and emits
/// it when it touches a key detections read (or with --registry-all).
fn finish_registry(ctx: &Shared, mut event: EventJson, kernel_key: &str) {
    let Some(registry) = event.registry.as_mut() else {
        return;
    };
    // A key rooted in a base the sensor never saw ("?\...") reads as the
    // writing process's own hive: the root resolves to HKU\<SID> from
    // the process's owner. The inference is declared on the event (and
    // the writer's user rides on it), so rules and suppressions can
    // demand it and an analyst can tell it from a seen path.
    let user = event.process.as_ref().and_then(|p| ctx.process_user(p.pid as u32));
    let (key, inferred_root) = netreg::registry_path_resolved(kernel_key, user.as_deref());
    registry.key = key;
    if let Some(root) = inferred_root {
        event.attributes.get_or_insert_with(Default::default).insert(String::from("registry_root_inferred"), root);
    }
    if event.user.is_none() {
        event.user = user;
    }
    let value_name = registry.value_name.clone().unwrap_or_default();
    if !ctx.registry_all && !netreg::interesting_registry(&registry.key, &value_name) {
        return;
    }
    ctx.emit(&event);
}
