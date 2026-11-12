import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  attributeValueSchema,
  DEFAULT_PORTS,
  invokeContract,
  profileInputSchema,
  profileSchema,
  streamContract,
  streamEventSchema,
  type AppError,
  type InvokeRequest,
  type InvokeResponse,
  type Profile,
  type RendererApi,
  type StreamEvent,
} from './ipc'

const profile: Profile = {
  id: 'p1',
  name: 'prod',
  host: 'ldap.example.com',
  port: 636,
  security: 'ldaps',
  bindDn: 'cn=admin,dc=example,dc=com',
  baseDn: '',
  caCertificates: [],
  hasSavedPassword: true,
}

describe('types derived from the contract', () => {
  it('types invoke requests and results', () => {
    expectTypeOf<InvokeRequest<'connection.connect'>>().toEqualTypeOf<{
      profileId: string
      password?: string | undefined
      savePassword?: boolean | undefined
    }>()
    expectTypeOf<InvokeResponse<'profiles.list'>>().toEqualTypeOf<
      { ok: true; value: Profile[] } | { ok: false; error: AppError }
    >()
  })

  it('types stream events per stream', () => {
    type SearchEvent = StreamEvent<'search.run'>
    expectTypeOf<Extract<SearchEvent, { kind: 'done' }>['data']>().toEqualTypeOf<{
      incomplete: boolean
      sizeLimitReached: boolean
    }>()
    expectTypeOf<RendererApi['invoke']>().parameter(0).toEqualTypeOf<keyof typeof invokeContract>()
  })
})

describe('schemas round-trip valid payloads', () => {
  it('keeps a profile unchanged', () => {
    expect(profileSchema.parse(profile)).toEqual(profile)
  })

  it('keeps binary values as bytes', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff])
    const parsed = attributeValueSchema.parse(bytes)
    expect(parsed).toBeInstanceOf(Uint8Array)
    expect(parsed).toEqual(bytes)
  })

  it('round-trips every invoke request example', () => {
    const examples: { [N in keyof typeof invokeContract]?: InvokeRequest<N> } = {
      'profiles.list': {},
      'connection.connect': { profileId: 'p1', password: 'secret', savePassword: false },
      'entry.modify': {
        connectionId: 'c1',
        dn: 'cn=a,dc=x',
        changes: [{ operation: 'replace', attribute: 'jpegPhoto', values: [new Uint8Array([1, 2])] }],
        assert: { attribute: 'entryCSN', value: '20261111000000.000000Z#000000#000#000000' },
      },
      'entry.rename': { connectionId: 'c1', dn: 'cn=a,dc=x', newRdn: 'cn=b', deleteOldRdn: true },
    }
    for (const [name, request] of Object.entries(examples)) {
      const schema = invokeContract[name as keyof typeof invokeContract].request
      expect(schema.parse(request)).toEqual(request)
    }
  })

  it('round-trips results and errors', () => {
    const response = invokeContract['profiles.list'].response
    expect(response.parse({ ok: true, value: [profile] })).toEqual({ ok: true, value: [profile] })
    const error = {
      ok: false,
      error: {
        kind: 'ldap',
        message: 'Invalid credentials',
        resultCode: 49,
        resultName: 'invalidCredentials',
      },
    }
    expect(response.parse(error)).toEqual(error)
  })

  it('round-trips stream events', () => {
    const schema = streamEventSchema('tree.children')
    const page = {
      operationId: 'op1',
      kind: 'page',
      data: { nodes: [{ dn: 'ou=a,dc=x', objectClasses: ['top'] }] },
    }
    expect(schema.parse(page)).toEqual(page)
    const done = { operationId: 'op1', kind: 'done', data: { incomplete: true } }
    expect(schema.parse(done)).toEqual(done)
  })
})

describe('schemas reject invalid payloads', () => {
  it('rejects a profile carrying a password', () => {
    const leaky = { ...profile, password: 'secret' }
    expect(profileSchema.strict().safeParse(leaky).success).toBe(false)
  })

  it('rejects bad ports, security modes and missing fields', () => {
    const input = { ...profile, password: { action: 'keep' } }
    expect(profileInputSchema.safeParse({ ...input, port: 0 }).success).toBe(false)
    expect(profileInputSchema.safeParse({ ...input, port: 70000 }).success).toBe(false)
    expect(profileInputSchema.safeParse({ ...input, security: 'ssl' }).success).toBe(false)
    expect(profileInputSchema.safeParse({ ...input, host: '' }).success).toBe(false)
    expect(profileInputSchema.safeParse({ ...input, password: { action: 'set' } }).success).toBe(false)
  })

  it('rejects an empty modify and non-binary objects as values', () => {
    const modify = invokeContract['entry.modify'].request
    expect(modify.safeParse({ connectionId: 'c1', dn: 'cn=a', changes: [] }).success).toBe(false)
    expect(attributeValueSchema.safeParse({ 0: 1 }).success).toBe(false)
    expect(attributeValueSchema.safeParse([1, 2]).success).toBe(false)
  })

  it('rejects stream events with the wrong data for their kind', () => {
    const schema = streamEventSchema('search.run')
    expect(schema.safeParse({ operationId: 'op1', kind: 'done', data: { incomplete: true } }).success).toBe(
      false,
    )
    expect(schema.safeParse({ operationId: '', kind: 'progress', data: { loaded: 1 } }).success).toBe(false)
  })

  it('rejects a search with an empty filter', () => {
    const request = streamContract['search.run'].request
    expect(
      request.safeParse({
        connectionId: 'c1',
        base: 'dc=x',
        scope: 'sub',
        filter: '',
        attributes: [],
        sizeLimit: 0,
      }).success,
    ).toBe(false)
  })
})

describe('defaults', () => {
  it('uses 389 for plain LDAP and StartTLS and 636 for LDAPS', () => {
    expect(DEFAULT_PORTS).toEqual({ none: 389, starttls: 389, ldaps: 636 })
  })
})
