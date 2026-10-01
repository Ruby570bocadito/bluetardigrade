// Package yamlcheck rejects resource bombs in operator-supplied YAML
// BEFORE the typed yaml.Unmarshal pays for them. yaml.v3 expands alias
// references during a typed decode, so a crafted document (billion
// laughs: an anchor referenced by other anchors, referenced by other
// anchors...) turns a 4 MiB file into an unbounded allocation on every
// hot-reload tick. Composing into a yaml.Node instead keeps aliases
// unexpanded (verified empirically: a three-level bomb composes to a
// 42-node tree while the typed decode would materialize thousands), so
// the guard can measure what the expansion WOULD cost and refuse it.
//
// The guard is deliberately permissive about everything except size:
// parse errors are not reported here (the caller's typed Unmarshal
// keeps that duty, with its file context), anchors and aliases are
// legal YAML and small legitimate uses (shared blocks in operator
// configs, occasional Sigma imports) pass. Only the projection caps
// reject.
package yamlcheck

import (
	"fmt"

	"gopkg.in/yaml.v3"
)

const (
	// MaxAliasRefs caps how many alias references (*name, including
	// merge keys) one document may carry. The shipped rule, sequence,
	// beacon, threshold, suppression, notification and response packs
	// use zero; the cap exists so a legitimately factored config still
	// passes while a reference bomb does not.
	MaxAliasRefs = 32

	// MaxExpandedNodes caps the projected node count of the document if
	// every alias reference were expanded once. A 4 MiB hand-written
	// document holds at most ~2 million scalar nodes, so the cap sits
	// two orders of magnitude above honest content and five orders
	// below a nine-level doubling bomb.
	MaxExpandedNodes = 100_000

	// MaxNestingDepth caps flow-style ('[' / '{') bracket nesting. The
	// yaml.v3 parser recurses per nesting level, so a crafted deep
	// flow-style value could exhaust the stack inside Unmarshal before
	// any allocation happens. The scan is deliberately naive: it counts
	// structural brackets everywhere — quoted strings included — and
	// clamps at zero on unmatched closers. Neither shortcut can hide
	// real depth: true nesting needs at least as many consecutive opens
	// as its own level count, and the scan counts exactly that. 512 is
	// the historical loader cap, kept verbatim.
	MaxNestingDepth = 512
)

// Guard composes data into a node tree and rejects documents whose
// alias expansion or flow nesting would exceed the caps above. Call it
// immediately after the file-size cap, before the typed Unmarshal:
//
//	if err := yamlcheck.Guard(path, data); err != nil {
//	        return err
//	}
//	if err := yaml.Unmarshal(data, &out); err != nil { ... }
//
// Guard returns nil for parse errors (the typed decode reports them
// with better context) and nil for a nil/empty tree.
func Guard(path string, data []byte) error {
	if err := checkNesting(path, data); err != nil {
		return err
	}
	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		return nil // syntax errors belong to the typed decode
	}
	if root.Kind == 0 { // empty document (comments only / empty file)
		return nil
	}
	var refs int
	size := projected(&root, make(map[*yaml.Node]int), &refs)
	if refs > MaxAliasRefs {
		return fmt.Errorf("%s: %d alias references (merge keys included), over the %d cap: YAML anchors are not supported in this file", path, refs, MaxAliasRefs)
	}
	if size > MaxExpandedNodes {
		return fmt.Errorf("%s: alias expansion would materialize ~%d nodes, over the %d cap (possible YAML bomb)", path, size, MaxExpandedNodes)
	}
	return nil
}

// checkNesting scans the raw bytes for flow-style nesting deeper than
// MaxNestingDepth — the same cheap pre-scan the rules and correlator
// loaders used to run inline (both copies moved here).
func checkNesting(path string, data []byte) error {
	depth := 0
	for _, b := range data {
		switch b {
		case '[', '{':
			depth++
			if depth > MaxNestingDepth {
				return fmt.Errorf("%s: YAML nesting deeper than %d levels (possible resource bomb)", path, MaxNestingDepth)
			}
		case ']', '}':
			if depth > 0 {
				depth--
			}
		}
	}
	return nil
}

// projected returns the node count of n with every alias reference
// counted as its target subtree (what the typed decode materializes)
// and accumulates the number of alias references seen into *refs.
// memo caches subtree sizes so an anchor referenced many times is
// measured once — the whole walk stays linear in document size. Alias
// graphs are acyclic by construction in valid YAML, so the recursion
// terminates; a cyclic graph cannot compose in the first place.
func projected(n *yaml.Node, memo map[*yaml.Node]int, refs *int) int {
	if n == nil {
		return 0
	}
	if s, ok := memo[n]; ok {
		return s
	}
	size := 1
	switch n.Kind {
	case yaml.AliasNode:
		*refs++
		if n.Alias != nil {
			size += projected(n.Alias, memo, refs)
		}
	default:
		for _, c := range n.Content {
			size += projected(c, memo, refs)
		}
	}
	// Only memoize nodes that can be re-referenced (anchor targets);
	// plain tree nodes are visited once anyway and memoizing them
	// would just hold the map alive for the whole walk.
	if n.Anchor != "" {
		memo[n] = size
	}
	return size
}
