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
	"os"

	"gopkg.in/yaml.v3"
)

// MaxReadBytes is the default file-size cap for operator-supplied YAML
// read through ReadFileCapped. The cap matters most on the HOT-RELOAD
// path: the reload ticker re-reads suppressions, known-software and
// operators every 15 s, so a file that grew (corruption, accident, or
// a hostile local write) must be refused BEFORE os.ReadFile allocates
// for it — otherwise a multi-GB file is loaded into memory on every
// tick, cycle after cycle.
const MaxReadBytes = 8 << 20

// ReadFileCapped reads path refusing files above capBytes BEFORE
// reading — the same os.Stat → cap → error pre-check every YAML loader
// of the engine applies (rules did it first; hot-reload loaders shared
// this single helper since the 2026-10 audit rounds). The returned
// error keeps the os.IsNotExist semantics of a direct os.ReadFile: a
// missing file surfaces as *fs.PathError so callers can treat absence
// as their documented degradation.
func ReadFileCapped(path string, capBytes int64) ([]byte, error) {
	fi, err := os.Stat(path)
	if err != nil {
		return nil, err // fs.PathError: callers keep os.IsNotExist handling
	}
	if fi.Size() > capBytes {
		return nil, fmt.Errorf("%s is %d bytes, above the %d MiB read cap", path, fi.Size(), capBytes>>20)
	}
	return os.ReadFile(path)
}

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
	// clamps at zero on unmatched closers. It is a conservative pre-scan,
	// not a YAML tokenizer. The composed graph is also checked below;
	// quoted brackets cannot hide flow depth from that check.
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
	if err := checkGraph(&root); err != nil {
		return fmt.Errorf("%s: %w", path, err)
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

// graphSize caches expansion cost and flow-container depth. The Node
// composer accepts self-referential aliases; only the typed decoder
// rejects them. A visiting set must detect those cycles BEFORE decode.
type graphSize struct {
	nodes int
	flow  int
}

// checkGraph walks iteratively so even a deep block-style document
// cannot exhaust this guard's call stack. Each node/alias is measured
// once. Costs are rejected before addition, avoiding integer overflow
// and stopping expansion estimates as soon as they exceed the budget.
func checkGraph(root *yaml.Node) error {
	type frame struct {
		node *yaml.Node
		next int
		size graphSize
	}
	stack := []frame{{node: root, size: graphSize{nodes: 1}}}
	visiting := map[*yaml.Node]bool{root: true}
	memo := make(map[*yaml.Node]graphSize)
	refs := 0
	add := func(dst *graphSize, child graphSize) error {
		if dst.nodes > MaxExpandedNodes-child.nodes {
			return fmt.Errorf("alias expansion exceeds the %d node cap (possible YAML bomb)", MaxExpandedNodes)
		}
		dst.nodes += child.nodes
		if child.flow > dst.flow {
			dst.flow = child.flow
		}
		return nil
	}
	for len(stack) > 0 {
		f := &stack[len(stack)-1]
		n := f.node
		var child *yaml.Node
		hasChild := false
		if n.Kind == yaml.AliasNode {
			if f.next == 0 {
				refs++
				if refs > MaxAliasRefs {
					return fmt.Errorf("%d alias references (merge keys included), over the %d cap", refs, MaxAliasRefs)
				}
				f.next++
				child, hasChild = n.Alias, true
			}
		} else if f.next < len(n.Content) {
			child, hasChild = n.Content[f.next], true
			f.next++
		}
		if hasChild {
			if child == nil {
				continue
			}
			if visiting[child] {
				return fmt.Errorf("cyclic YAML alias graph is not supported")
			}
			if size, ok := memo[child]; ok {
				if err := add(&f.size, size); err != nil {
					return err
				}
			} else {
				visiting[child] = true
				stack = append(stack, frame{node: child, size: graphSize{nodes: 1}})
			}
			continue
		}
		if n.Style&yaml.FlowStyle != 0 && (n.Kind == yaml.SequenceNode || n.Kind == yaml.MappingNode) {
			f.size.flow++
		}
		if f.size.flow > MaxNestingDepth {
			return fmt.Errorf("YAML flow nesting deeper than %d levels (possible resource bomb)", MaxNestingDepth)
		}
		size := f.size
		memo[n] = size
		delete(visiting, n)
		stack = stack[:len(stack)-1]
		if len(stack) > 0 {
			if err := add(&stack[len(stack)-1].size, size); err != nil {
				return err
			}
		}
	}
	return nil
}
