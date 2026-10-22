package rules

import (
	"slices"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// AD WEF pack (M-7): rules over the Windows event log records the WEF
// subscription forwards from domain controllers and servers. Every
// rule fires on the record it names and stays quiet on the legitimate
// domain operation that shares the event ID: DC machine-account
// replication, AES Kerberos tickets, machine-account group adds
// (DC promotion), services installed from their signed binary.

var wefPackRuleNames = []string{
	"Replicacion DCSUAPI desde cuenta no-maquina (DCSync)",
	"Ticket Kerberos con cifrado RC4 (Kerberoasting)",
	"Alta en grupo privilegiado del dominio",
	"Servicio nuevo con interprete o ruta escribible (7045)",
}

// winEvent builds a windows.event record the way the M-7 contract
// defines it (docs/AD-WEF-SUSCRIPCION.md): host is the originating
// computer, user the account the record is about, semantics in
// attributes under the win_* namespace.
func winEvent(t *testing.T, user string, attrs map[string]string) *model.Event {
	t.Helper()
	if _, ok := attrs["win_event_id"]; !ok {
		t.Fatal("winEvent needs win_event_id")
	}
	if _, ok := attrs["win_channel"]; !ok {
		attrs["win_channel"] = "Security"
	}
	return &model.Event{
		ID:         "wef-test-1",
		Timestamp:  time.Now().UTC(),
		Type:       model.TypeWindowsEvent,
		Source:     "wef",
		Host:       "LAB-DC-01",
		User:       user,
		Attributes: attrs,
	}
}

func assertWEFPackQuiet(t *testing.T, e *Engine, ev *model.Event) {
	t.Helper()
	for _, hit := range e.Evaluate(ev) {
		if slices.Contains(wefPackRuleNames, hit.Rule.Name) {
			t.Fatalf("benign record fired WEF rule %q", hit.Rule.Name)
		}
	}
}

func assertWEFExactlyFired(t *testing.T, e *Engine, ev *model.Event, want []string) {
	t.Helper()
	var got []string
	for _, hit := range e.Evaluate(ev) {
		if slices.Contains(wefPackRuleNames, hit.Rule.Name) {
			got = append(got, hit.Rule.Name)
		}
	}
	if !slices.Equal(got, want) {
		t.Fatalf("expected WEF hits %v, got %v", want, got)
	}
}

func TestWEFPackAttackCases(t *testing.T) {
	e := loadTestEngine(t)

	t.Run("dcsync by a user account", func(t *testing.T) {
		ev := winEvent(t, `CORP\jsmith`, map[string]string{
			"win_event_id":           "4662",
			"win_object_server":      "DS",
			"win_object_type":        "%{19195a5b-52da-4cc4-a2c4-9e00e954c8bb}",
			"win_subject_user":       "jsmith",
			"win_access_mask":        "0x100",
			"win_property":           "{1131f6ad-4c08-4eab-a6d3-9e5a6b0e3c5c}",
			"win_subject_is_machine": "false",
		})
		assertWEFExactlyFired(t, e, ev, []string{"Replicacion DCSUAPI desde cuenta no-maquina (DCSync)"})
	})

	t.Run("kerberoasting rc4 ticket", func(t *testing.T) {
		ev := winEvent(t, `CORP\jsmith`, map[string]string{
			"win_event_id":          "4769",
			"win_service":           "MSSQLSvc/sql01.corp.local:1433",
			"win_ticket_encryption": "0x17",
			"win_ip":                "::ffff:10.0.0.50",
		})
		assertWEFExactlyFired(t, e, ev, []string{"Ticket Kerberos con cifrado RC4 (Kerberoasting)"})
	})

	t.Run("privilegiated group add covers the three scopes", func(t *testing.T) {
		for _, id := range []string{"4728", "4732", "4756"} {
			ev := winEvent(t, `CORP\admin`, map[string]string{
				"win_event_id":          id,
				"win_group":             "Domain Admins",
				"win_member":            "eviluser",
				"win_member_is_machine": "false",
				"win_actor":             "admin",
			})
			assertWEFExactlyFired(t, e, ev, []string{"Alta en grupo privilegiado del dominio"})
		}
	})

	t.Run("spanish privileged group add also fires", func(t *testing.T) {
		ev := winEvent(t, `CORP\admin`, map[string]string{
			"win_event_id":          "4728",
			"win_group":             "Administradores del dominio",
			"win_member":            "cuenta.nueva",
			"win_member_is_machine": "false",
			"win_actor":             "admin",
		})
		assertWEFExactlyFired(t, e, ev, []string{"Alta en grupo privilegiado del dominio"})
	})

	t.Run("service with interpreter binary", func(t *testing.T) {
		ev := winEvent(t, `CORP\admin`, map[string]string{
			"win_channel":      "System",
			"win_event_id":     "7045",
			"win_service":      "WindowsUpdater",
			"win_image_path":   `%COMSPEC% /c powershell.exe -enc SQBFAFgA`,
			"win_service_type": "own process",
			"win_start_mode":   "auto start",
			"win_actor":        "SYSTEM",
		})
		assertWEFExactlyFired(t, e, ev, []string{"Servicio nuevo con interprete o ruta escribible (7045)"})
	})

	t.Run("service into a user-writable path", func(t *testing.T) {
		ev := winEvent(t, `CORP\admin`, map[string]string{
			"win_channel":      "System",
			"win_event_id":     "7045",
			"win_service":      "HelperSvc",
			"win_image_path":   `C:\Users\Public\helper.exe`,
			"win_service_type": "own process",
			"win_start_mode":   "auto start",
			"win_actor":        `CORP\admin`,
		})
		assertWEFExactlyFired(t, e, ev, []string{"Servicio nuevo con interprete o ruta escribible (7045)"})
	})
}

func TestWEFPackBenignCases(t *testing.T) {
	e := loadTestEngine(t)

	t.Run("dc machine-account replication is the DC working", func(t *testing.T) {
		ev := winEvent(t, `CORP\LAB-DC-02$`, map[string]string{
			"win_event_id":           "4662",
			"win_object_server":      "DS",
			"win_subject_user":       "LAB-DC-02$",
			"win_access_mask":        "0x100",
			"win_property":           "{1131f6ad-4c08-4eab-a6d3-9e5a6b0e3c5c}",
			"win_subject_is_machine": "true",
		})
		assertWEFPackQuiet(t, e, ev)
	})

	t.Run("aes ticket is not a kerberoastable request", func(t *testing.T) {
		ev := winEvent(t, `CORP\jsmith`, map[string]string{
			"win_event_id":          "4769",
			"win_service":           "cifs/fileserver.corp.local",
			"win_ticket_encryption": "0x12",
		})
		assertWEFPackQuiet(t, e, ev)
	})

	t.Run("machine account added to a group is DC management", func(t *testing.T) {
		ev := winEvent(t, `CORP\admin`, map[string]string{
			"win_event_id":          "4728",
			"win_group":             "Domain Admins",
			"win_member":            "LAB-DC-03$",
			"win_member_is_machine": "true",
			"win_actor":             "admin",
		})
		assertWEFPackQuiet(t, e, ev)
	})

	t.Run("non-privileged group add stays quiet", func(t *testing.T) {
		ev := winEvent(t, `CORP\rrhh-admin`, map[string]string{
			"win_event_id":          "4732",
			"win_group":             "Impresoras Oficina",
			"win_member":            "becario2",
			"win_member_is_machine": "false",
			"win_actor":             "rrhh-admin",
		})
		assertWEFPackQuiet(t, e, ev)
	})

	t.Run("signed service from its own binary stays quiet", func(t *testing.T) {
		ev := winEvent(t, "SYSTEM", map[string]string{
			"win_channel":      "System",
			"win_event_id":     "7045",
			"win_service":      "AVAgent",
			"win_image_path":   `"C:\Program Files\Vendor\agent.exe" /svc`,
			"win_service_type": "own process",
			"win_start_mode":   "auto start",
			"win_actor":        "SYSTEM",
		})
		assertWEFPackQuiet(t, e, ev)
	})

	t.Run("unrelated windows records stay quiet", func(t *testing.T) {
		for _, attrs := range []map[string]string{
			{"win_event_id": "4624", "win_logon_type": "2"},
			{"win_event_id": "4740", "win_target_user": "jsmith"},
		} {
			assertWEFPackQuiet(t, e, winEvent(t, `CORP\jsmith`, attrs))
		}
	})
}
