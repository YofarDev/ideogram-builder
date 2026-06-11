import { describe, it, expect, beforeEach } from 'vitest'
import { on, emit } from '../events.js'

describe('event bus', () => {
  it('calls listener when event is emitted', () => {
    const calls = []
    on('test:event', (data) => calls.push(data))
    emit('test:event', 'hello')
    expect(calls).toEqual(['hello'])
  })

  it('calls multiple listeners for same event', () => {
    const a = [], b = []
    on('evt', (x) => a.push(x))
    on('evt', (x) => b.push(x))
    emit('evt', 42)
    expect(a).toEqual([42])
    expect(b).toEqual([42])
  })

  it('does nothing when emitting unregistered event', () => {
    expect(() => emit('nothing', {})).not.toThrow()
  })

  it('passes data to all listeners', () => {
    const calls = []
    on('evt', (d) => calls.push(d))
    emit('evt', { x: 1 })
    emit('evt', { y: 2 })
    expect(calls).toEqual([{ x: 1 }, { y: 2 }])
  })
})
