package collector

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // explicit IANA zones must also work on Windows

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// SetFirewallTimezone supplies the source machine's zone for #Time Format: Local.
// The collector machine's implicit Local zone is never used.
func (d *Decoder) SetFirewallTimezone(zone string) error {
	if zone == "" || zone == "Local" {
		return errors.New("provide an explicit IANA firewall timezone (for example Europe/Madrid)")
	}
	location, err := time.LoadLocation(zone)
	if err != nil {
		return errors.New("invalid IANA firewall timezone")
	}
	d.firewallZone = location
	return nil
}

func (d *Decoder) decodeFirewall(line string) (*model.Event, error) {
	line = strings.TrimSpace(line)
	if line == "" {
		return nil, ErrIgnored
	}
	if strings.HasPrefix(line, "#") {
		switch {
		case strings.HasPrefix(line, "#Version:"):
			d.firewallFields = nil
			d.firewallFormat = ""
		case strings.HasPrefix(line, "#Time Format:"):
			format := strings.TrimSpace(strings.TrimPrefix(line, "#Time Format:"))
			if format != "Local" && format != "UTC" {
				return nil, errors.New("unsupported firewall time format")
			}
			d.firewallFormat = format
		case strings.HasPrefix(line, "#Fields:"):
			fields := strings.Fields(strings.TrimPrefix(line, "#Fields:"))
			if len(fields) < 8 || len(fields) > 64 {
				return nil, errors.New("invalid firewall field count")
			}
			seen := map[string]bool{}
			for _, key := range fields {
				if seen[key] {
					return nil, errors.New("duplicate firewall field")
				}
				seen[key] = true
			}
			for _, key := range []string{"date", "time", "action", "protocol", "src-ip", "dst-ip", "src-port", "dst-port"} {
				if !seen[key] {
					return nil, fmt.Errorf("missing firewall field %s", key)
				}
			}
			d.firewallFields = fields
		}
		return nil, ErrIgnored
	}
	if len(d.firewallFields) == 0 || d.firewallFormat == "" {
		return nil, errors.New("firewall data requires #Fields and #Time Format headers")
	}
	values := strings.Fields(line)
	if len(values) != len(d.firewallFields) {
		return nil, errors.New("firewall row does not match #Fields")
	}
	row := map[string]any{}
	for i, key := range d.firewallFields {
		row[key] = values[i]
	}
	action := text(row, "action")
	if action != "ALLOW" && action != "DROP" {
		if action == "OPEN" || action == "CLOSE" || action == "INFO-EVENTS-LOST" {
			return nil, ErrIgnored
		}
		return nil, errors.New("unsupported firewall action")
	}
	zone := time.UTC
	if d.firewallFormat == "Local" {
		if d.firewallZone == nil {
			return nil, errors.New("firewall Local timestamps require -firewall-timezone")
		}
		zone = d.firewallZone
	}
	stamp := text(row, "date") + " " + text(row, "time")
	const layout = "2006-01-02 15:04:05"
	ts, err := time.ParseInLocation(layout, stamp, zone)
	if err != nil || ts.Year() < 1970 || ts.Format(layout) != stamp {
		return nil, errors.New("invalid or nonexistent firewall timestamp")
	}
	// Reject duplicated wall clock times around DST rather than silently
	// assigning an arbitrary offset to forensic evidence.
	for _, delta := range []time.Duration{30 * time.Minute, time.Hour, 2 * time.Hour} {
		if ts.Add(delta).In(zone).Format(layout) == stamp || ts.Add(-delta).In(zone).Format(layout) == stamp {
			return nil, errors.New("ambiguous firewall timestamp; use UTC source logs")
		}
	}
	for _, key := range []string{"src-port", "dst-port"} {
		if text(row, key) == "-" {
			delete(row, key)
		}
	}
	netw, err := network(row, "src-ip", "dst-ip", "src-port", "dst-port", "protocol", true)
	if err != nil {
		return nil, err
	}
	ev := d.event(model.TypeNetworkFirewall, d.Observer, ts)
	ev.Network = netw
	put(ev.Attributes, "firewall_action", strings.ToLower(action))
	put(ev.Attributes, "source_timestamp", stamp)
	put(ev.Attributes, "source_timezone", zone.String())
	switch text(row, "path") {
	case "RECEIVE":
		ev.Attributes["firewall_direction"] = "inbound"
	case "SEND":
		ev.Attributes["firewall_direction"] = "outbound"
	}
	if pid := text(row, "pid"); pid != "" && pid != "-" {
		n, err := unsigned(pid, math.MaxUint32)
		if err != nil {
			return nil, errors.New("invalid firewall pid")
		}
		ev.Attributes["firewall_pid"] = strconv.FormatUint(n, 10)
	}
	ev.ID = d.id([]byte(zone.String() + "\n" + line))
	return ev, nil
}
