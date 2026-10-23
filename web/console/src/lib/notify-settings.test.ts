import { describe, expect, test } from 'bun:test'
import { channelPayload, channelProblems, emptyChannel, notifyDirty, parseRecipients, secretStored, statsFor, type NotifyChannel, type NotifySettings } from './notify-settings'

const saved = (channels: NotifyChannel[], console_url = ''): NotifySettings => ({ path: 'x', exists: true, console_url, channels, stats: [] })

describe('notify settings client', () => {
  test('a new channel gets a free name and the fields of its type', () => {
    expect(emptyChannel('email', []).name).toBe('email')
    expect(emptyChannel('email', ['email', 'email-2']).name).toBe('email-3')
    expect(emptyChannel('email', []).starttls).toBe(true)
    expect(emptyChannel('ntfy', [])).toMatchObject({ url: '', topic: '', min_severity: 'high' })
  })

  test('the payload carries no read-only flags and no empty secrets', () => {
    const ch: NotifyChannel = { type: 'telegram', name: ' guardia ', min_severity: 'critical', token: '', token_set: true, chat_id: ' -100 ', api_url: '', url_label: 'x' }
    expect(channelPayload(ch)).toEqual({ type: 'telegram', name: 'guardia', min_severity: 'critical', chat_id: '-100' })
    // a typed secret travels as typed; clear_secret travels
    expect(channelPayload({ ...ch, token: ' 12:ab ' }).token).toBe(' 12:ab ')
    expect(channelPayload({ ...ch, clear_secret: true }).clear_secret).toBe(true)
    // fields of other types never travel
    expect(channelPayload({ type: 'slack', name: 's', min_severity: '', url: 'https://h/x', topic: 'zz', server: 'h:1' })).toEqual({ type: 'slack', name: 's', min_severity: '', url: 'https://h/x' })
    expect(channelPayload({ type: 'email', name: 'm', min_severity: '', server: 'h:25', from: 'a@b', to: [' c@d ', ''], starttls: false })).toEqual({ type: 'email', name: 'm', min_severity: '', server: 'h:25', from: 'a@b', starttls: false, to: ['c@d'] })
  })

  test('recipients split on commas, semicolons and newlines', () => {
    expect(parseRecipients('a@b, c@d;e@f\n g@h ,')).toEqual(['a@b', 'c@d', 'e@f', 'g@h'])
  })

  test('the problems the engine would refuse are named per channel', () => {
    const ok: NotifyChannel[] = [
      { type: 'slack', name: 's', min_severity: '', url: 'https://hooks.slack.com/x' },
      { type: 'ntfy', name: 'n', min_severity: '', url: 'https://ntfy.sh', topic: 'soc_1' },
      { type: 'telegram', name: 't', min_severity: '', chat_id: '-1', token_env: 'SF_TG' },
      { type: 'email', name: 'e', min_severity: '', server: 'smtp.lab:587', from: 'a@b', to: ['c@d'] },
    ]
    expect(channelProblems(ok)).toEqual([null, null, null, null])
    expect(channelProblems([{ ...ok[0], name: '' }])).toEqual(['name'])
    expect(channelProblems([ok[0], { ...ok[1], name: 's' }])).toEqual([null, 'duplicate'])
    expect(channelProblems([{ ...ok[0], url: '' }])).toEqual(['url'])
    // a stored hook needs no url in the draft
    expect(channelProblems([{ ...ok[0], url: '', url_set: true }])).toEqual([null])
    expect(channelProblems([{ ...ok[1], topic: 'a/b' }])).toEqual(['topic'])
    expect(channelProblems([{ ...ok[2], token_env: '' }])).toEqual(['token'])
    expect(channelProblems([{ ...ok[2], token_env: '', token_set: true }])).toEqual([null])
    expect(channelProblems([{ ...ok[2], token_env: '', token_set: true, clear_secret: true }])).toEqual(['token'])
    expect(channelProblems([{ ...ok[3], server: 'smtp.lab' }])).toEqual(['server'])
    expect(channelProblems([{ ...ok[3], to: [] }])).toEqual(['to'])
    expect(channelProblems([{ ...ok[3], username: 'u' }])).toEqual(['password'])
    expect(channelProblems([{ ...ok[3], username: 'u', password_set: true }])).toEqual([null])
  })

  test('stored secrets and stats are matched by name and type', () => {
    expect(secretStored({ type: 'email', name: 'm', min_severity: '', password_set: true })).toBe(true)
    expect(secretStored({ type: 'slack', name: 's', min_severity: '', url_set: true })).toBe(true)
    const stats = [{ name: 's', type: 'slack', sent: 3, failed: 0, dropped: 0, filtered: 1 }]
    expect(statsFor(stats, { type: 'slack', name: 's', min_severity: '' })?.sent).toBe(3)
    expect(statsFor(stats, { type: 'ntfy', name: 's', min_severity: '' })).toBeNull()
  })

  test('dirty compares what would travel', () => {
    const chs: NotifyChannel[] = [{ type: 'slack', name: 's', min_severity: 'high', url_set: true, url_label: 'https://h' }]
    expect(notifyDirty(saved(chs), '', chs)).toBe(false)
    expect(notifyDirty(saved(chs), 'https://soc', chs)).toBe(true)
    expect(notifyDirty(saved(chs), '', [{ ...chs[0], min_severity: 'critical' }])).toBe(true)
    expect(notifyDirty(saved(chs), '', [{ ...chs[0], url: 'https://new' }])).toBe(true)
    expect(notifyDirty(null, '', [])).toBe(false)
  })
})
