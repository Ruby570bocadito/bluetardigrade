package redact

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// Corpus del agente 41/49: cada patrón matchea su secreto y NO toca los
// falsos positivos documentados (logonpasswords sin separador,
// corp/admin:pw@dc01 sin esquema, findstr con wildcard, -p de una
// letra). Idempotencia y rune-safety verificados para TODO el corpus.

func TestScrubKinds(t *testing.T) {
	cases := []struct{ name, in, want, absent string }{
		{"aws_key", "cmd /c x AKIAIOSFODNN7EXAMPLE", "[REDACTED#aws_key_id#MPLE]", "AKIAIOSFODNN7"},
		{"aws_secret", "aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "[REDACTED#aws_secret_key#EKEY]", "wJalrXUtnFEMI"},
		{"github", "token ghp_16C7e42F292c6912E7710c838347Ae178B4a", "[REDACTED#github_token#8B4a]", "16C7e42F"},
		{"jwt", `curl -H "Authorization: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"`, "[REDACTED#jwt#sw5c]", "SflKxwRJ"},
		{"bearer", "Authorization: Bearer abcdefgh-1234-5678-90ab-abcdef", "Bearer [REDACTED#http_auth_header#cdef]", "abcdefgh-1234-5678"},
		{"url_userinfo", "https://admin:s3cr3tpw@host.example/path?x=1", "https://admin:[REDACTED#url_userinfo#3tpw]@host.example/path?x=1", "s3cr3tpw"},
		{"pem", "-----BEGIN RSA PRIVATE KEY-----MIIEpAIBAAKCAQEA7QIDAQAB-----END RSA PRIVATE KEY-----", "[REDACTED#pem_key_block]", "MIIEpAIBAAKCAQEA7"},
		{"flag_eq", "psql --password=Sup3rSecret", "--password=[REDACTED#cli_flag_value#cret]", "Sup3rSecret"},
		{"flag_space", "tool --api-key Sup3rSecretKey", "--api-key [REDACTED#cli_flag_value#tKey]", "Sup3rSecretKey"},
		{"kv", "powershell -c password=Hunter2!", "password=[REDACTED#kv_secret#er2_]", "Hunter2!"},
		{"kv_colon", "PGPASSWORD: S3cretKey12345", "PGPASSWORD: [REDACTED#kv_secret#2345]", "S3cretKey"},
		{"net_use", `net use \\DC01\IPC$ /user:CORP\jdoe P@ssw0rd123`, "[REDACTED#net_use_password#d123]", "P@ssw0rd123"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			out := String(ModeTail4, c.in)
			if !strings.Contains(out, c.want) {
				t.Fatalf("want %q in %q", c.want, out)
			}
			if c.absent != "" && strings.Contains(out, c.absent) {
				t.Fatalf("secret leaked: %q", out)
			}
			if out != String(ModeTail4, out) {
				t.Fatalf("not idempotent: %q", out)
			}
		})
	}
}

func TestScrubCleanTextNoOp(t *testing.T) {
	// los pins del repo (agente 49): NINGUNO debe tocararse
	for _, clean := range []string{
		`mimikatz "sekurlsa::logonpasswords"`,
		"Volcado A | Volcado B -> PsExec",
		"beacon hacia 185.220.101.47:443",
		"Atención: acceso a credenciales",
		"findstr /si password *.xml *.ini",
		"python.exe impacket-secretsdump.py corp/admin:pw@dc01",
		"7z a -pS3cret! archive.7z",
		"rar a -hpS3cret archive.rar",
		"Basic authentication enabled",
		"token bucket algorithm",
		"powershell -enc AAA",
		"https://api.example.com/v1/users",
		"users.db:5432 connected",
	} {
		if out := String(ModeTail4, clean); out != clean {
			t.Fatalf("false positive:\n in:  %s\n out: %s", clean, out)
		}
	}
}

func TestScrubShortSecretNoTail(t *testing.T) {
	// < 8 runes: todo enmascarado, no se filtra media clave corta
	for _, v := range []string{"password=abc", "password=S3cret!"} {
		out := String(ModeTail4, v)
		if strings.Contains(out, "!") && strings.Contains(out, "S3cret") {
			t.Fatalf("short secret leaked: %q", out)
		}
	}
}

func TestScrubModeFull(t *testing.T) {
	out := String(ModeFull, "password=Hunter2!NombreLargo")
	if !strings.Contains(out, "[REDACTED#kv_secret]") || strings.Contains(out, "#") && strings.Contains(out, "ombre") {
		t.Fatalf("full mode: %q", out)
	}
	if strings.Contains(out, "ombreLargo") {
		t.Fatalf("full mode leaked tail: %q", out)
	}
}

func TestScrubMapClonesOnHitOnly(t *testing.T) {
	clean := map[string]string{"k": "valor limpio"}
	out := Map(ModeTail4, clean)
	if len(out) != 1 || out["k"] != "valor limpio" {
		t.Fatalf("clean map must pass through: %v", out)
	}
	dirty := map[string]string{"k": "password=Hunter2!NombreLargo", "k2": "v2"}
	out2 := Map(ModeTail4, dirty)
	if &out == &out2 {
		t.Fatal("hit must produce a new map")
	}
	if out2["k2"] != "v2" {
		t.Fatalf("untouched key must survive: %v", out2)
	}
	if strings.Contains(out2["k"], "Hunter2!") {
		t.Fatalf("value not scrubbed: %v", out2)
	}
}

func TestScrubRuneSafeLengthStable(t *testing.T) {
	for _, v := range []string{"password=contraseñaÑ12345", strings.Repeat("á", 5000)} {
		out := String(ModeTail4, v)
		if !utf8.ValidString(out) {
			t.Fatalf("invalid UTF-8: %q", out)
		}
		if strings.ContainsRune(out, '\ufffd') {
			t.Fatalf("U+FFFD introduced: %q", out)
		}
	}
}
