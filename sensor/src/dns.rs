// dns.rs: platform-independent decoding of the DNS client's "query
// completed" event (Microsoft-Windows-DNS-Client, event 3008), kept
// apart from the Windows-only collector so it is unit-tested on any host.
//
//   - query results: the event renders the answer as one string,
//     "type:  5 cdn.example.net;::ffff:93.184.216.34;2606:2800::1;",
//     where CNAME hops carry a "type:" prefix and IPv4 answers come
//     IPv4-mapped. The addresses are extracted in order.
//   - noise: browsers and services repeat the same query constantly. A
//     (process, name) pair is reported, then its repeats are dropped for
//     as long as they keep arriving less than a minute apart (a sliding
//     window). A fixed "once a minute" would turn a 5-second poller into
//     a perfectly regular 60-second series, which the engine's beacon
//     detector would read as an implant; this way only real gaps of over
//     a minute produce new events, so true cadences stay visible.
//   - IP -> domain: answers are remembered for ten minutes so the TCP
//     connection that follows the lookup carries the domain it was for
//     (the same field Sysmon-based rules and the intel lists read).

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

const REPEAT_WINDOW: Duration = Duration::from_secs(60);
const ANSWER_TTL: Duration = Duration::from_secs(600);
const MAX_RECENT: usize = 4096;
const MAX_ANSWERS: usize = 16_384;
const MAX_NAME: usize = 253;

/// Normalized query name: lowercase, without the trailing dot. None for
/// names that are not worth reporting (empty, reverse lookups, too long).
pub fn query_name(raw: &str) -> Option<String> {
    let name = raw.trim().trim_end_matches('.').to_ascii_lowercase();
    if name.is_empty() || name.len() > MAX_NAME || name.ends_with(".arpa") || name == "localhost" {
        return None;
    }
    if name.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    Some(name)
}

/// Addresses in a QueryResults string, in answer order (CNAME hops and
/// anything unparseable skipped, IPv4-mapped IPv6 shown as IPv4).
pub fn answer_ips(results: &str) -> Vec<IpAddr> {
    results
        .split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty() && !entry.starts_with("type:"))
        .filter_map(|entry| entry.parse::<IpAddr>().ok())
        .map(|ip| match ip {
            IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(IpAddr::V6(v6)),
            v4 => v4,
        })
        .filter(|ip| !ip.is_unspecified() && !ip.is_loopback())
        .collect()
}

/// Deduplication of repeated queries and the IP -> domain memory.
pub struct DnsState {
    recent: HashMap<(u32, String), Instant>,
    answers: HashMap<IpAddr, (String, Instant)>,
}

impl Default for DnsState {
    fn default() -> Self {
        Self::new()
    }
}

impl DnsState {
    pub fn new() -> Self {
        DnsState { recent: HashMap::new(), answers: HashMap::new() }
    }

    /// Records a completed query and reports whether it should be
    /// forwarded (false for a repeat of the same process and name less
    /// than the repeat window after the previous one, forwarded or not).
    /// Answers are remembered either way.
    pub fn observe(&mut self, pid: u32, name: &str, ips: &[IpAddr], now: Instant) -> bool {
        if self.answers.len() + ips.len() > MAX_ANSWERS {
            self.answers.retain(|_, (_, at)| now.duration_since(*at) < ANSWER_TTL);
            if self.answers.len() + ips.len() > MAX_ANSWERS {
                self.answers.clear();
            }
        }
        for ip in ips {
            self.answers.insert(*ip, (name.to_string(), now));
        }
        let key = (pid, name.to_string());
        if let Some(at) = self.recent.get_mut(&key) {
            let quiet = now.duration_since(*at) >= REPEAT_WINDOW;
            *at = now; // sliding: every repeat extends the quiet period
            return quiet;
        }
        if self.recent.len() >= MAX_RECENT {
            self.recent.retain(|_, at| now.duration_since(*at) < REPEAT_WINDOW);
            if self.recent.len() >= MAX_RECENT {
                self.recent.clear();
            }
        }
        self.recent.insert(key, now);
        true
    }

    /// The name a recent answer resolved to ip, if any.
    pub fn domain_for(&self, ip: &IpAddr, now: Instant) -> Option<String> {
        self.answers
            .get(ip)
            .filter(|(_, at)| now.duration_since(*at) < ANSWER_TTL)
            .map(|(name, _)| name.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_names_are_normalized_and_noise_dropped() {
        assert_eq!(query_name("WWW.Example.COM.").as_deref(), Some("www.example.com"));
        assert_eq!(query_name("wpad").as_deref(), Some("wpad"));
        assert_eq!(query_name("4.3.2.1.in-addr.arpa"), None);
        assert_eq!(query_name("localhost"), None);
        assert_eq!(query_name("   "), None);
        assert_eq!(query_name(&"a".repeat(300)), None);
        assert_eq!(query_name("bad name.example"), None);
    }

    #[test]
    fn answers_skip_cnames_and_unmap_ipv4() {
        let ips = answer_ips("type:  5 cdn.example.net;::ffff:93.184.216.34;2606:2800:220:1::248;");
        assert_eq!(ips, vec!["93.184.216.34".parse::<IpAddr>().unwrap(), "2606:2800:220:1::248".parse().unwrap()]);
        assert_eq!(answer_ips("198.51.100.4;"), vec!["198.51.100.4".parse::<IpAddr>().unwrap()]);
        assert!(answer_ips("").is_empty());
        assert!(answer_ips("::;127.0.0.1;garbage").is_empty());
    }

    #[test]
    fn repeats_are_suppressed_per_process_and_answers_remembered() {
        let mut st = DnsState::new();
        let t0 = Instant::now();
        let ip: IpAddr = "203.0.113.10".parse().unwrap();
        assert!(st.observe(100, "mal.example.com", &[ip], t0));
        assert!(!st.observe(100, "mal.example.com", &[ip], t0 + Duration::from_secs(5)), "repeat inside the window");
        assert!(st.observe(200, "mal.example.com", &[ip], t0 + Duration::from_secs(5)), "another process is reported");
        assert!(st.observe(100, "mal.example.com", &[ip], t0 + Duration::from_secs(66)), "after a quiet minute again");
        assert_eq!(st.domain_for(&ip, t0 + Duration::from_secs(70)).as_deref(), Some("mal.example.com"));
        assert_eq!(st.domain_for(&ip, t0 + Duration::from_secs(66 + 601)), None, "answers expire");
        assert_eq!(st.domain_for(&"192.0.2.1".parse().unwrap(), t0), None);
    }

    #[test]
    fn suppression_never_invents_a_cadence() {
        let t0 = Instant::now();
        // a 5-second poller for ten minutes: one event, not one a minute
        let mut st = DnsState::new();
        let forwarded = (0..120).filter(|i| st.observe(7, "telemetry.example.com", &[], t0 + Duration::from_secs(i * 5))).count();
        assert_eq!(forwarded, 1);
        // a real 90-second cadence is forwarded every time
        let mut st = DnsState::new();
        let forwarded = (0..10).filter(|i| st.observe(7, "c2.example.com", &[], t0 + Duration::from_secs(i * 90))).count();
        assert_eq!(forwarded, 10);
    }

    #[test]
    fn state_stays_bounded() {
        let mut st = DnsState::new();
        let t0 = Instant::now();
        for i in 0..(MAX_RECENT as u32 + 10) {
            st.observe(i, "x.example", &[], t0);
        }
        assert!(st.recent.len() <= MAX_RECENT);
        let ips: Vec<IpAddr> = (0..(MAX_ANSWERS as u32 + 10)).map(|i| IpAddr::V4(i.into())).collect();
        for chunk in ips.chunks(100) {
            st.observe(1, "y.example", chunk, t0);
        }
        assert!(st.answers.len() <= MAX_ANSWERS);
    }
}
