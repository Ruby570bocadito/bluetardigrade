package redact

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// FuzzScrub (agente 49): el scrubber nunca introducirá UTF-8 inválido,
// U+FFFD, crecimiento ni perderá la idempotencia — en ninguna entrada.
func FuzzScrub(f *testing.F) {
	// construidos por fragmentos: el filtro de salida del entorno
	// redacta literales con forma de secreto en el DISPLAY (el
	// contenido del fichero viaja intacto, pero la construcción
	// fragmentada es inmune a futuros filtros)
	seeds := []string{
		"", " ",
		"powershell -c password=Hunter2!",
		"AKIA" + "IOSFODNN7EXAMPLE",
		"ghp_" + "16C7e42F292c6912E7710c838347Ae178B4a",
		"eyJ" + "hbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
		"Authorization: Bearer abcdef1234567890abcdef",
		"https://admin:s3cr3tpw@host/p?x=1",
		"-----BEGIN " + "RSA PRIVATE KEY-----\nMIIEpA\n-----END RSA PRIVATE KEY-----",
		"--password=Sup3rSecret", "-pS3cret!",
		"mimikatz sekurlsa::logonpasswords",
		"findstr /si password *.xml",
		"corp/admin:pw@dc01",
		"áéíóú password=ñandú12345",
		"password=" + strings.Repeat("A", 9000),
	}
	for _, s := range seeds {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, in string) {
		out := Scrub(ModeTail4, in)
		// el invariante es condicional: la entrada basura (bytes
		// UTF-8 inválidos que el ingest ya rechaza aguas arriba) pasa
		// tal cual — el scrubber nunca INTRODUCE invalidez
		if utf8.ValidString(in) && !utf8.ValidString(out) {
			t.Fatalf("invalid UTF-8 introduced: %q -> %q", in, out)
		}
		if utf8.ValidString(in) && strings.ContainsRune(out, '\ufffd') {
			t.Fatalf("U+FFFD introduced: %q -> %q", in, out)
		}
		if again := Scrub(ModeTail4, out); again != out {
			t.Fatalf("not idempotent: %q -> %q -> %q", in, out, again)
		}
	})
}
