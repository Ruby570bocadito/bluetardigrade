// Host groups (engine GET /api/groups, PUT /api/settings/groups): named
// sets of machines by host-name pattern, Active Directory OU or ingest
// identity. Equipos shows and filters by them; Ajustes edits them. The
// engine validates every save; the helpers here only shape the editor's
// text fields into the request and back.

import { engineCall, type EngineResult } from './engine-writes'

export type HostGroup = {
  name: string
  label: string
  hosts: string[]
  ad_ou: string[]
  identities: string[]
}

export type HostGroupWithMembers = HostGroup & { members: string[] }

export type HostGroupsPayload = {
  enabled: boolean
  writable: boolean
  ad: boolean
  groups: HostGroupWithMembers[]
  ungrouped: string[]
}

export function fetchHostGroups(): Promise<EngineResult<HostGroupsPayload>> {
  return engineCall<HostGroupsPayload>('GET', '/api/groups')
}

export function saveHostGroups(groups: HostGroup[]): Promise<EngineResult<HostGroupsPayload>> {
  return engineCall<HostGroupsPayload>('PUT', '/api/settings/groups', { groups }, {}, 12000)
}

/** One criterion per line (or comma), blanks dropped: the editor's textareas. */
export function parseLines(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Lines of a textarea for DNs: commas belong to the DN, so only newlines
 * separate entries.
 */
export function parseDNLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** The editor's draft of one group: criteria as raw textarea text. */
export type GroupDraft = { name: string; label: string; hosts: string; ad_ou: string; identities: string }

export function draftOf(g: HostGroup): GroupDraft {
  return { name: g.name, label: g.label, hosts: g.hosts.join('\n'), ad_ou: g.ad_ou.join('\n'), identities: g.identities.join('\n') }
}

export function groupOf(d: GroupDraft): HostGroup {
  return {
    name: d.name.trim(),
    label: d.label.trim(),
    hosts: parseLines(d.hosts),
    ad_ou: parseDNLines(d.ad_ou),
    identities: parseLines(d.identities),
  }
}

/** Name suggestion from a label: "Sede de Madrid" -> "sede-de-madrid". */
export function nameFromLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}
