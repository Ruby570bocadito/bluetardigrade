// Package api: guard for the db query surface (M-4): turns a client statement into
// either a single read-only SELECT or a rejection that names the rule
// it broke. It is the FIRST layer; the read-only handle in internal/store
// is the last one, and neither may be trusted alone.
//
// What it accepts: one statement starting with SELECT, WITH or VALUES.
// WITH is safe under the flat verb ban below because SQLite cannot
// execute a write from inside a subquery — "WITH x AS (SELECT ...) DELETE
// FROM t" carries the verb at top level and is caught by it like any
// other write form.
//
// What it rejects, with the reason: anything not starting with one of
// those keywords; more than one statement (any ';' outside quotes after
// the optional trailing one); any write or side-effect verb (INSERT,
// UPDATE, DELETE, DROP, PRAGMA, ATTACH, load_extension, ...) appearing as
// a word outside quoted regions — comments included, so a commented-out
// verb never travels to the driver inside a "harmless" query; NUL and
// other control bytes; statements over the size cap.

package api

import (
	"fmt"
	"strings"
)

// dbQueryMaxLen bounds the statement: an operator query fits far below
// it, and the cap keeps the audit row small and the decode cheap.
const dbQueryMaxLen = 32 << 10

// dbQueryStarters are the statement-leading keywords the surface
// accepts. VALUES is the statement form of a constant SELECT.
var dbQueryStarters = map[string]bool{
	"select": true,
	"with":   true,
	"values": true,
}

// dbQueryBlockedVerbs bans every word that can start or perform a write
// or a side effect in SQLite. REPLACE is banned even as the string
// function: REPLACE INTO is a write, the string function has IFNULL-
// shaped substitutes, and a ban that survives grammar drift is worth
// more here than expression-level precision.
var dbQueryBlockedVerbs = map[string]bool{
	"insert":         true,
	"update":         true,
	"delete":         true,
	"drop":           true,
	"alter":          true,
	"create":         true,
	"attach":         true,
	"detach":         true,
	"pragma":         true,
	"vacuum":         true,
	"reindex":        true,
	"analyze":        true,
	"begin":          true,
	"commit":         true,
	"rollback":       true,
	"savepoint":      true,
	"release":        true,
	"replace":        true,
	"grant":          true,
	"revoke":         true,
	"load_extension": true,
	"readfile":       true,
	"writefile":      true,
	"fts3_tokenizer": true,
	"eval":           true,
}

// blockedVerb also catches the PRAGMA-as-table-function spelling
// (pragma_table_info, ...) and any future pragma_xxx addition.
func blockedVerb(word string) bool {
	return dbQueryBlockedVerbs[word] || strings.HasPrefix(word, "pragma_")
}

func isWordByte(c byte) bool {
	return c == '_' || c == '$' ||
		(c >= '0' && c <= '9') ||
		(c >= 'a' && c <= 'z') ||
		(c >= 'A' && c <= 'Z')
}

// scanner states; quote bytes and comment regions never mix, so a
// quote inside a comment is comment text and a comment marker inside a
// string is string text.
const (
	stCode = iota
	stSingle
	stDouble
	stBacktick
	stBracket
	stLineComment
	stBlockComment
)

// guardSQL validates in and returns the trimmed statement ready to run.
func guardSQL(in string) (string, error) {
	if len(in) > dbQueryMaxLen {
		return "", fmt.Errorf("statement over the %d byte cap", dbQueryMaxLen)
	}
	s := strings.TrimSpace(in)
	if s == "" {
		return "", fmt.Errorf("empty statement; send one SELECT")
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < 0x20 && c != '\t' && c != '\n' && c != '\r' {
			return "", fmt.Errorf("statement contains control characters")
		}
	}
	// one optional trailing ';': strip exactly one, then the scanner
	// refuses any other semicolon it meets in code
	if strings.HasSuffix(s, ";") {
		s = strings.TrimSpace(s[:len(s)-1])
		if s == "" {
			return "", fmt.Errorf("empty statement; send one SELECT")
		}
	}
	// the statement must START with the bare keyword: a leading quote
	// or parenthesis is not a SELECT however it reads
	head := 0
	for head < len(s) && isWordByte(s[head]) {
		head++
	}
	if head == 0 || !dbQueryStarters[strings.ToLower(s[:head])] {
		return "", fmt.Errorf("statements must start with SELECT (or WITH/VALUES)")
	}

	var (
		word    strings.Builder
		state   = stCode
		verbErr error
	)
	flush := func() {
		if verbErr != nil || word.Len() == 0 {
			return
		}
		w := strings.ToLower(word.String())
		word.Reset()
		if blockedVerb(w) {
			// named so the operator knows which word tripped it;
			// the rare false positive (an unquoted column named
			// "release") is a SQLite syntax error anyway — quote
			// it and it passes
			verbErr = fmt.Errorf("verb %q is not allowed on the read-only query surface", w)
		}
	}
	for i := 0; i < len(s) && verbErr == nil; i++ {
		c := s[i]
		switch state {
		case stSingle:
			if c == '\'' {
				if i+1 < len(s) && s[i+1] == '\'' {
					i++ // '' escapes one quote inside the string
				} else {
					state = stCode
				}
			}
		case stDouble:
			if c == '"' {
				if i+1 < len(s) && s[i+1] == '"' {
					i++
				} else {
					state = stCode
				}
			}
		case stBacktick:
			if c == '`' {
				if i+1 < len(s) && s[i+1] == '`' {
					i++
				} else {
					state = stCode
				}
			}
		case stBracket:
			if c == ']' {
				state = stCode
			}
		case stLineComment:
			switch {
			case c == '\n':
				state = stCode
			case isWordByte(c):
				word.WriteByte(c)
			default:
				flush()
			}
		case stBlockComment:
			switch {
			case c == '*' && i+1 < len(s) && s[i+1] == '/':
				i++
				state = stCode
			case isWordByte(c):
				word.WriteByte(c)
			default:
				flush()
			}
		default: // code
			switch {
			case c == '\'':
				flush()
				state = stSingle
			case c == '"':
				flush()
				state = stDouble
			case c == '`':
				flush()
				state = stBacktick
			case c == '[':
				flush()
				state = stBracket
			case c == '-' && i+1 < len(s) && s[i+1] == '-':
				flush()
				i++
				state = stLineComment
			case c == '/' && i+1 < len(s) && s[i+1] == '*':
				flush()
				i++
				state = stBlockComment
			case c == ';':
				return "", fmt.Errorf("one statement per query: remove the extra ';'")
			case isWordByte(c):
				word.WriteByte(c)
			default:
				flush()
			}
		}
	}
	flush()
	if verbErr != nil {
		return "", verbErr
	}
	return s, nil
}
