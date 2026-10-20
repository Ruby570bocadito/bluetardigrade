import { expect, test } from 'bun:test'
import { draftOf, groupOf, nameFromLabel, parseDNLines, parseLines } from './host-groups'

test('textareas become criteria lists; DNs keep their commas', () => {
  expect(parseLines(' pc-mad-*\n\nsrv-01, srv-02 \n')).toEqual(['pc-mad-*', 'srv-01', 'srv-02'])
  expect(parseDNLines('OU=Madrid,DC=corp,DC=local\n  \nOU=Sevilla,DC=corp,DC=local')).toEqual(['OU=Madrid,DC=corp,DC=local', 'OU=Sevilla,DC=corp,DC=local'])
})

test('a group survives the editor round trip', () => {
  const g = { name: 'madrid', label: 'Sede de Madrid', hosts: ['pc-mad-*'], ad_ou: ['ou=madrid,dc=corp'], identities: ['sede-mad'] }
  expect(groupOf(draftOf(g))).toEqual(g)
  expect(groupOf({ name: ' a ', label: ' ', hosts: '', ad_ou: '', identities: '' })).toEqual({ name: 'a', label: '', hosts: [], ad_ou: [], identities: [] })
})

test('a label suggests a valid group name', () => {
  expect(nameFromLabel('Sede de Málaga (servidores)')).toBe('sede-de-malaga-servidores')
  expect(nameFromLabel('  --  ')).toBe('')
  expect(nameFromLabel('x'.repeat(40))).toHaveLength(32)
})
