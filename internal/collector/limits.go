package collector

import (
	"bytes"
	"errors"
	"io"
)

// utf8BOM is what Windows tools put in front of UTF-8 text: Windows
// PowerShell 5.1's Set-Content -Encoding UTF8, Notepad, and the stdin
// of a native command when the console code page is 65001.
var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// ErrUTF16Input rejects a whole UTF-16 file with the fix instead of a
// per-line "not UTF-8": Out-File and '>' write UTF-16LE by default on
// Windows PowerShell 5.1, so exported logs often arrive that way.
var ErrUTF16Input = errors.New("input is UTF-16 (the default of Out-File and '>' in Windows PowerShell 5.1): save it as UTF-8, e.g. Get-Content in.json | Set-Content -Encoding utf8 out.json")

// FirstLine prepares the first line of a line-oriented input: a UTF-8
// byte-order mark is dropped (the rest of the file is plain UTF-8) and
// a UTF-16 byte-order mark is refused with ErrUTF16Input.
func FirstLine(line []byte) ([]byte, error) {
	if bytes.HasPrefix(line, []byte{0xFF, 0xFE}) || bytes.HasPrefix(line, []byte{0xFE, 0xFF}) {
		return nil, ErrUTF16Input
	}
	return bytes.TrimPrefix(line, utf8BOM), nil
}

func readBounded(reader io.Reader, limit int64) ([]byte, error) {
	raw, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > limit {
		return nil, errors.New("input limit exceeded")
	}
	return raw, nil
}
