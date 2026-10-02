package model

import (
	"sort"
	"strconv"
)

// ObservationSearchFields is shared by ring and SQLite searches. Separate
// keys and values prevent matches crossing two observation boundaries.
func ObservationSearchFields(attributes map[string]string, network *Network) []string {
	keys := make([]string, 0, len(attributes))
	for key := range attributes {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, 2*len(keys)+7)
	for _, key := range keys {
		parts = append(parts, key, attributes[key])
	}
	if network != nil {
		parts = append(parts, network.Protocol, network.SourceIP, network.DestinationIP, network.Domain)
		if network.SourcePort != 0 {
			parts = append(parts, strconv.Itoa(network.SourcePort))
		}
		if network.DestinationPort != 0 {
			parts = append(parts, strconv.Itoa(network.DestinationPort))
		}
	}
	return parts
}
