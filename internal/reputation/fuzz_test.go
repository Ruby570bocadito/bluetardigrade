package reputation

// SEC-7 (fuzzing of the input surfaces): fuzz targets for the analyst
// supplied indicator validation, the gate that decides what may leave
// the engine towards third-party reputation providers. `go test` runs
// the seed corpus.
//
// Properties under fuzz:
//   - ValidateIP never panics; when it accepts, the returned value is
//     the canonical form of a public unicast address (never private,
//     loopback, link-local, multicast or unspecified — the privacy
//     promise of the feature) and validating it again is idempotent.
//   - ValidateHash never panics; when it accepts, the value is
//     lowercase hex of an allowed length and idempotent under
//     re-validation.

import (
	"net"
	"testing"
)

func FuzzValidateIP(f *testing.F) {
	f.Add("8.8.8.8")
	f.Add("192.0.2.1")
	f.Add("1.2.3.4 ")
	f.Add(" 2001:db8::1")
	f.Add("10.0.0.1")
	f.Add("127.0.0.1")
	f.Add("169.254.1.2")
	f.Add("224.0.0.1")
	f.Add("0.0.0.0")
	f.Add("::1")
	f.Add("fe80::1")
	f.Add("::ffff:10.0.0.1")
	f.Add("8.8.8.8/24")
	f.Add("999.1.1.1")
	f.Add("not an ip")
	f.Add("")
	f.Add("\x008.8.8.8")
	f.Add("1.2.3.4\n")

	f.Fuzz(func(t *testing.T, raw string) {
		got, err := ValidateIP(raw)
		if err != nil {
			if got != "" {
				t.Fatalf("ValidateIP(%q) returned value %q together with error %v", raw, got, err)
			}
			return
		}
		ip := net.ParseIP(got)
		if ip == nil {
			t.Fatalf("ValidateIP(%q) accepted %q which does not parse back", raw, got)
		}
		if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsMulticast() || ip.IsUnspecified() {
			t.Fatalf("ValidateIP(%q) accepted a non-routable address %q", raw, got)
		}
		again, err := ValidateIP(got)
		if err != nil || again != got {
			t.Fatalf("ValidateIP not idempotent for %q: got (%q, %v)", got, again, err)
		}
	})
}

func FuzzValidateHash(f *testing.F) {
	f.Add("44d88612fea8a8f36de82e1278abb02f")
	f.Add("3395856ce81f2b7382dee72602f798b642f14140")
	f.Add("275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f")
	f.Add("44D88612FEA8A8F36DE82E1278ABB02F")
	f.Add(" 44d88612fea8a8f36de82e1278abb02f ")
	f.Add("44d88612fea8a8f36de82e1278abb02")
	f.Add("44d88612fea8a8f36de82e1278abb02fa")
	f.Add("zzd88612fea8a8f36de82e1278abb02f")
	f.Add("")
	f.Add("deadbeef")

	f.Fuzz(func(t *testing.T, raw string) {
		got, err := ValidateHash(raw)
		if err != nil {
			if got != "" {
				t.Fatalf("ValidateHash(%q) returned value %q together with error %v", raw, got, err)
			}
			return
		}
		if len(got) != 32 && len(got) != 40 && len(got) != 64 {
			t.Fatalf("ValidateHash(%q) accepted a %d-length hash", raw, len(got))
		}
		for _, c := range got {
			if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
				t.Fatalf("ValidateHash(%q) accepted non-lowercase-hex %q", raw, got)
			}
		}
		again, err := ValidateHash(got)
		if err != nil || again != got {
			t.Fatalf("ValidateHash not idempotent for %q: got (%q, %v)", got, again, err)
		}
	})
}
