package api

import (
	"strings"
	"testing"
)

func TestGuardSQLAcceptsReadOnlyStatements(t *testing.T) {
	valid := []string{
		"SELECT 1",
		"select host, count(*) from events group by host",
		"  SELECT * FROM alerts WHERE severity = 'high'  ",
		"SELECT 1;",  // one trailing semicolon is stripped
		"select 1 ;", // with trailing space too
		"WITH top AS (SELECT * FROM events) SELECT host, COUNT(*) FROM top GROUP BY host",
		"with recent as (select * from alerts where ts > 0) select * from recent",
		"VALUES (1), (2)",
		"SELECT 'a;b' AS s",         // semicolon inside a string
		"SELECT 'delete' AS word",   // verb inside a string
		`SELECT "release" FROM t`,   // quoted identifier with a banned word
		"SELECT 'it''s; fine' AS s", // doubled-quote escape keeps the string closed
		"SELECT * FROM t WHERE a = 'x' -- trailing comment",
		"SELECT a\n\tFROM t\nWHERE b = 1",
		"SELECT upper(host) FROM events LIMIT 10",
		"SELECT json_extract(json, '$.process.name') FROM events LIMIT 5",
		"SeLeCt 1",
		"SELECT * FROM events WHERE search LIKE '%powershell%'",
	}
	for _, q := range valid {
		got, err := guardSQL(q)
		if err != nil {
			t.Errorf("guardSQL(%q): unexpected error %v", q, err)
			continue
		}
		if strings.TrimSpace(got) == "" {
			t.Errorf("guardSQL(%q): empty statement out", q)
		}
	}
}

func TestGuardSQLRejectsEverythingElse(t *testing.T) {
	cases := map[string]string{
		"":                                  "empty",
		"   ":                               "empty",
		";":                                 "empty",
		"UPDATE events SET host = 'x'":      "start",
		"DELETE FROM alerts":                "start",
		"INSERT INTO events VALUES (1)":     "start",
		"PRAGMA journal_mode(WAL)":          "start",
		"VACUUM":                            "start",
		"(SELECT 1)":                        "start",
		"'SELECT 1'":                        "start",
		"ATTACH DATABASE 'x' AS y":          "start",
		"SELECT 1; SELECT 2":                "one statement",
		"SELECT 1;":                         "", // stripped, must PASS
		"SELECT 1;;":                        "one statement",
		"SELECT 1; DROP TABLE events":       "one statement",
		"SELECT * FROM t; ATTACH 'b' AS b2": "one statement",
		"WITH x AS (SELECT 1) DELETE FROM events":                "delete",
		"SELECT 1 UNION SELECT 2; INSERT INTO events VALUES (2)": "one statement",
		"SELECT load_extension('evil')":                          "load_extension",
		"select * from pragma_table_info('events')":              "pragma_",
		"SELECT writefile('/tmp/x', 'y')":                        "writefile",
		"SELECT readfile('/etc/passwd')":                         "readfile",
		"SELECT replace('a','b','c')":                            "replace", // banned on purpose (REPLACE INTO)
		"SELECT 1 /* ; */":                                       "",        // semicolon inside comment must PASS
		"SELECT 1 -- then delete from events":                    "delete",  // commented verb: refused
		"SELECT 1 /* drop table */":                              "drop",    // block-commented verb: refused
		"DELETE":                                                 "start",
		"SELECT " + strings.Repeat("x", 40<<10):                  "cap",
		"SELECT 1\x00":                                           "control",
	}
	for q, want := range cases {
		_, err := guardSQL(q)
		switch want {
		case "": // must PASS
			if err != nil {
				t.Errorf("guardSQL(%q): unexpected error %v", q, err)
			}
		case "start":
			if err == nil || strings.Contains(err.Error(), "one statement") {
				t.Errorf("guardSQL(%q): err=%v, want starter refusal", q, err)
			}
		case "cap":
			if err == nil || !strings.Contains(err.Error(), "cap") {
				t.Errorf("guardSQL(%q): err=%v, want size-cap refusal", q, err)
			}
		case "control":
			if err == nil || !strings.Contains(err.Error(), "control") {
				t.Errorf("guardSQL(%q): err=%v, want control-character refusal", q, err)
			}
		case "one statement":
			if err == nil || !strings.Contains(err.Error(), "one statement") {
				t.Errorf("guardSQL(%q): err=%v, want one-statement refusal", q, err)
			}
		default: // a verb: the refusal must name it
			if err == nil || !strings.Contains(err.Error(), want) {
				t.Errorf("guardSQL(%q): err=%v, want refusal naming %q", q, err, want)
			}
		}
	}
}

func TestGuardSQLCommentsAreScannedToo(t *testing.T) {
	// a commented-out verb is refused: comments travel with the
	// statement into logs and audit rows, and a guard that ignores
	// them teaches operators to hide things in comments
	_, err := guardSQL("SELECT 1 -- then delete from events")
	if err == nil || !strings.Contains(err.Error(), "delete") {
		t.Fatalf("commented verb accepted: %v", err)
	}
	_, err = guardSQL("SELECT 1 /* drop table */")
	if err == nil || !strings.Contains(err.Error(), "drop") {
		t.Fatalf("block-commented verb accepted: %v", err)
	}
}

func FuzzSQLGuard(f *testing.F) {
	for _, seed := range []string{
		"SELECT 1", "SELECT 1; DROP TABLE events", "WITH x AS (SELECT 1) DELETE FROM t",
		"SELECT 'a;b'", "PRAGMA journal_mode(WAL)", "SELECT '''; DELETE FROM t",
		"values(1)", "SELECT * FROM events WHERE host = 'LAB'", "SELECT 1 /* delete */",
		"select 'it''s'", "UPDATE t SET a=1", "",
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, stmt string) {
		got, err := guardSQL(stmt)
		if err != nil {
			return
		}
		// invariants for every accepted statement
		if len(got) > dbQueryMaxLen {
			t.Fatalf("accepted statement over the cap")
		}
		lower := strings.ToLower(got)
		var starter bool
		for k := range dbQueryStarters {
			if strings.HasPrefix(lower, k) {
				starter = true
			}
		}
		if !starter {
			t.Fatalf("accepted non-SELECT statement: %q", got)
		}
		if strings.ContainsRune(stmt, 0) {
			t.Fatalf("accepted NUL byte")
		}
	})
}
