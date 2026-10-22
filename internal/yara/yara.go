// Package yara keeps the engine's YARA rule pack (M-3): the directory the
// operator curates with -yara-rules, the distribution version its optional
// bundle.json names, and the content fingerprint the sensors report back
// in their heartbeat (yara_rules_sha). The API layer serves the pack
// status and a zip bundle an operator drops next to the sensor's
// --yara-rules directory; the sensor reloads it within a minute without a
// restart. Delivery is out of band until the signed server-to-sensor
// channel exists (E-1), so the pack is unsigned for now.
//
// The fingerprint mirrors the sensor's loader (sensor/src/yara.rs, load):
// the rule files (*.yar/*.yara, UTF-8, sorted by relative path with '/'
// separators) hashed as rel + NUL + content, SHA-256, first 16 hex
// characters. A sensor whose whole pack compiles therefore reports
// exactly the fingerprint computed here, and arrival verification is a
// string comparison against the fleet: a host whose yara_rules_sha
// differs with yara_errors == 0 still runs an older pack, one that
// differs with yara_errors > 0 holds a file it could not compile (this
// side counts files, the sensor counts compiled rules).
package yara

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// ManifestName is the optional distribution manifest next to the rule
// files; the sensor skips it when compiling and reads {"version": "..."}.
const ManifestName = "bundle.json"

// MaxPackBytes caps the pack that ships as a bundle: 32 MiB of rule text
// is a mistake (the sensor refuses to scan files over 16 MiB anyway).
const MaxPackBytes = 32 << 20

// Zip failures the API maps to responses; everything else is I/O.
var (
	ErrEmptyPack = errors.New("the rule pack has no rule files")
	ErrTooLarge  = errors.New("the rule pack exceeds the distribution cap")
)

// File is one rule file of the pack, by relative path with '/' separators
// (the name the sensor's compile errors use for the same file).
type File struct {
	Name  string `json:"name"`
	Bytes int64  `json:"bytes"`
}

// Status is one reading of the pack.
type Status struct {
	// Dir is the directory the pack lives in.
	Dir string `json:"dir,omitempty"`
	// Version is what the pack's bundle.json names, empty without one.
	Version string `json:"version,omitempty"`
	// Sha16 is the content fingerprint the sensors' heartbeat reports
	// (yara_rules_sha), empty while the pack has no rule files.
	Sha16 string `json:"sha16,omitempty"`
	// Files are the rule files the fingerprint covers, by name.
	Files []File `json:"files"`
	// TotalBytes is the size of the rule files, manifest excluded.
	TotalBytes int64 `json:"total_bytes"`
	// Problems name the files a sensor will refuse (unreadable, not
	// UTF-8) and a manifest it would not be able to read a version from.
	Problems []string `json:"problems"`
}

// Store is the engine's view of the pack directory, safe for concurrent
// use. Refresh re-reads it only when the directory changed (the same
// laziness as internal/intel), so the API can call it on every request.
type Store struct {
	dir string
	mu  sync.Mutex
	sig string // change signature of the last Refresh
	st  Status // last reading, valid after the first Refresh
}

// Load points the store at dir. A directory that cannot be stated is an
// error: -yara-rules pointing nowhere is a configuration mistake worth a
// startup log line, not a silent empty pack.
func Load(dir string) (*Store, error) {
	if strings.TrimSpace(dir) == "" {
		return nil, errors.New("yara: empty rules directory")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, fmt.Errorf("yara: %w", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, fmt.Errorf("yara: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("yara: %s is not a directory", abs)
	}
	return &Store{dir: abs, st: Status{Dir: abs, Files: []File{}, Problems: []string{}}}, nil
}

// Dir is the directory the store watches.
func (s *Store) Dir() string { return s.dir }

// Refresh re-reads the pack when the directory changed since the last
// Refresh (files, sizes or modification times — the sensor's own change
// signal) and reports whether it re-read. An unreadable directory is a
// reading of its own: the status carries the reason as its only problem.
func (s *Store) Refresh() bool {
	rows, sig, err := walkPack(s.dir)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err == nil && sig == s.sig {
		return false
	}
	s.sig = sig
	if err != nil {
		s.st = Status{Dir: s.dir, Files: []File{}, Problems: []string{err.Error()}}
		return true
	}
	s.st = readPack(s.dir, rows)
	return true
}

// Snapshot is the last reading (Refresh computes it).
func (s *Store) Snapshot() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.st
	out.Files = append([]File{}, s.st.Files...)
	out.Problems = append([]string{}, s.st.Problems...)
	return out
}

// Zip writes the pack as a zip archive: the rule files the fingerprint
// covers plus the manifest when it exists, in name order, with zeroed
// timestamps so the same pack always produces the same bytes. Files the
// status flags as problems do not travel — the operator fixes or removes
// them, the pack stays exactly what its sha16 describes.
func (s *Store) Zip(w io.Writer) error {
	st := s.Snapshot()
	if len(st.Files) == 0 {
		return ErrEmptyPack
	}
	if st.TotalBytes > MaxPackBytes {
		return ErrTooLarge
	}
	zw := zip.NewWriter(w)
	for _, f := range st.Files {
		data, err := os.ReadFile(filepath.Join(s.dir, filepath.FromSlash(f.Name)))
		if err != nil {
			_ = zw.Close()
			return err
		}
		if err := writeEntry(zw, f.Name, data); err != nil {
			_ = zw.Close()
			return err
		}
	}
	if data, err := os.ReadFile(filepath.Join(s.dir, ManifestName)); err == nil {
		if err := writeEntry(zw, ManifestName, data); err != nil {
			_ = zw.Close()
			return err
		}
	}
	return zw.Close()
}

func writeEntry(zw *zip.Writer, name string, data []byte) error {
	h := &zip.FileHeader{Name: name, Method: zip.Deflate, Modified: time.Unix(0, 0).UTC()}
	f, err := zw.CreateHeader(h)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	return err
}

// packRow is one file of the pack walk: relative path with '/'
// separators, absolute path and the stat fields of the change signature.
type packRow struct {
	rel   string
	path  string
	size  int64
	mtime int64 // nanoseconds since the epoch, 0 before it (as the sensor counts)
}

// walkPack collects the files the sensor's own walk would see: rule files
// and the manifest, recursive over directories whose name does not start
// with a dot, sorted by relative path (the order both the fingerprint and
// the compile errors rely on). The signature is the sensor's directory
// fingerprint (rel, size, mtime rows): when it stops changing, the pack
// reads the same.
func walkPack(dir string) ([]packRow, string, error) {
	var rows []packRow
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // an entry that comes and goes is skipped, as the sensor skips it
		}
		name := d.Name()
		if d.IsDir() {
			if p != dir && strings.HasPrefix(name, ".") {
				return fs.SkipDir
			}
			return nil
		}
		if !d.Type().IsRegular() {
			return nil // symlinks and the like are the operator's business, not the pack's
		}
		if !isRuleFile(name) && name != ManifestName {
			return nil
		}
		rel, rerr := filepath.Rel(dir, p)
		if rerr != nil {
			return rerr
		}
		rel = filepath.ToSlash(rel)
		var size, mtime int64
		if info, ierr := d.Info(); ierr == nil {
			size = info.Size()
			mtime = info.ModTime().UnixNano()
			if mtime < 0 {
				mtime = 0
			}
		}
		rows = append(rows, packRow{rel: rel, path: p, size: size, mtime: mtime})
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].rel < rows[j].rel })
	h := sha256.New()
	for _, r := range rows {
		fmt.Fprintf(h, "%s\x00%d\x00%d\n", r.rel, r.size, r.mtime)
	}
	return rows, hex.EncodeToString(h.Sum(nil)), nil
}

// readPack turns the walk into a Status: every UTF-8 rule file joins the
// fingerprint (rel + NUL + content, the sensor's own sha16), everything
// it would refuse is named in Problems.
func readPack(dir string, rows []packRow) Status {
	st := Status{Dir: dir, Files: []File{}, Problems: []string{}}
	h := sha256.New()
	for _, row := range rows {
		if row.rel == ManifestName {
			if v := manifestVersion(row.path, &st); v != "" {
				st.Version = v
			}
			continue
		}
		data, err := os.ReadFile(row.path)
		if err != nil {
			st.Problems = append(st.Problems, fmt.Sprintf("%s: %v", row.rel, err))
			continue
		}
		if !utf8.Valid(data) {
			st.Problems = append(st.Problems, fmt.Sprintf("%s: not valid UTF-8 (YARA source is text)", row.rel))
			continue
		}
		h.Write([]byte(row.rel))
		h.Write([]byte{0})
		h.Write(data)
		st.Files = append(st.Files, File{Name: row.rel, Bytes: int64(len(data))})
		st.TotalBytes += int64(len(data))
	}
	if len(st.Files) > 0 {
		st.Sha16 = hex.EncodeToString(h.Sum(nil))[:16]
	}
	return st
}

// manifestVersion reads {"version": "..."} the way the sensor does: a
// manifest it cannot parse or one without a string version contributes
// nothing — here the operator also gets a problem row for it.
func manifestVersion(path string, st *Status) string {
	data, err := os.ReadFile(path)
	if err != nil {
		st.Problems = append(st.Problems, fmt.Sprintf("%s: %v", ManifestName, err))
		return ""
	}
	var m struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(data, &m); err != nil {
		st.Problems = append(st.Problems, fmt.Sprintf("%s: not valid JSON (its version is ignored)", ManifestName))
		return ""
	}
	return m.Version
}

func isRuleFile(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasSuffix(lower, ".yar") || strings.HasSuffix(lower, ".yara")
}
