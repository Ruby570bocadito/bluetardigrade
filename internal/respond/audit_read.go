package respond

// Read-side of the audit file (console visibility, 02-B): the JSONL is
// the proof surface of a destructive mechanism, so reads tail it
// without ever locking, truncating or rewriting it — the writer keeps
// its append+fsync contract untouched and a concurrent read may at
// worst observe a line that is still being appended (dropped here as
// the torn tail it is, never half-parsed into a record).

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// maxAuditScanBytes bounds how much of the file one read scans back
// from the end. With the field caps of Request (reason 512 runes, host
// 253, names 256...) a line stays in the low KiB, so 4 MiB covers the
// API limit of 500 records with wide margin; a window that cannot even
// find one line boundary is reported instead of guessed around.
const maxAuditScanBytes = 4 << 20

// ReadAuditTail returns up to n of the most recent audit records at
// path, newest first, plus the honest bookkeeping of the scan:
//   - skipped: lines that are not records (the torn tail of a
//     concurrent append or a line that failed to parse) — counted,
//     never silently dropped and never passed through as data;
//   - truncated: older records exist beyond the scan window (the
//     rotation story stays the operator's, exactly like the writer).
//
// A missing file is an error (the caller owns the message: the surface
// was armed with an open audit, so an unreadable file is a real
// incident, not an empty state).
func ReadAuditTail(path string, n int) (records []Record, skipped int, truncated bool, err error) {
	if n <= 0 {
		return nil, 0, false, fmt.Errorf("respond audit: limit must be positive, got %d", n)
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, false, fmt.Errorf("respond audit: open %s: %w", path, err)
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, 0, false, fmt.Errorf("respond audit: stat %s: %w", path, err)
	}
	size := st.Size()
	if size == 0 {
		return []Record{}, 0, false, nil
	}

	window := size
	if window > maxAuditScanBytes {
		window = maxAuditScanBytes
		truncated = true
	}
	start := size - window
	buf := make([]byte, window)
	if _, err := f.ReadAt(buf, start); err != nil && err != io.EOF {
		return nil, 0, truncated, fmt.Errorf("respond audit: read %s: %w", path, err)
	}

	// mid-file window: discard the cut fragment of the oldest line so
	// every parsed line is a whole one
	if start > 0 {
		idx := bytes.IndexByte(buf, '\n')
		if idx < 0 {
			// one line larger than the whole window: impossible under
			// the field caps, and guessing would fabricate audit data
			return nil, 0, truncated, fmt.Errorf("respond audit: single line exceeds the %d MiB scan window", maxAuditScanBytes>>20)
		}
		buf = buf[idx+1:]
	}

	// torn tail: a fragment without the trailing newline is an append
	// in flight (or a torn historical line) — not a record yet
	if len(buf) > 0 && buf[len(buf)-1] != '\n' {
		skipped++
		if idx := bytes.LastIndexByte(buf, '\n'); idx >= 0 {
			buf = buf[:idx+1]
		} else {
			buf = nil
		}
	}

	records = make([]Record, 0, n)
	for i := len(buf) - 1; i >= 0 && len(records) < n; {
		end := bytes.LastIndexByte(buf[:i], '\n') + 1 // start of line i
		line := bytes.TrimSpace(buf[end:i])
		i = end - 1
		if len(line) == 0 {
			continue
		}
		var rec Record
		if uerr := json.Unmarshal(line, &rec); uerr != nil {
			skipped++
			continue
		}
		records = append(records, rec)
	}
	return records, skipped, truncated, nil
}
