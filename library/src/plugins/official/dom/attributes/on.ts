// Authors: Delaney Gillilan
// Icon: material-symbols:mail
// Slug: Add an event listener to an element
// Description: This action adds an event listener to an element. The event listener can be triggered by a variety of events, such as clicks, keypresses, and more. The event listener can also be set to trigger only once, or to be passive or capture. The event listener can also be debounced or throttled. The event listener can also be set to trigger only when the event target is outside the element.

import { type AttributePlugin, PluginType, Requirement } from '~/engine/types'
import { onElementRemoved } from '~/utils/dom'
import { tagHas, tagToMs } from '~/utils/tags'
import { kebabize } from '~/utils/text'
import { debounce, throttle } from '~/utils/timing'

const lastSignalsMarshalled = new Map<string, any>()

const EVT = 'evt'
export const On: AttributePlugin = {
  type: PluginType.Attribute,
  name: 'on',
  keyReq: Requirement.Must,
  valReq: Requirement.Must,
  argNames: [EVT],
  macros: {
    pre: [
      {
        // We need to escape the evt in case .value is used
        type: PluginType.Macro,
        name: 'evtEsc',
        fn: (original) => {
          return original.replaceAll(/evt.([\w\.]+)value/gm, 'EVT_$1_VALUE')
        },
      },
    ],
    post: [
      {
        // We need to unescape the evt in case .value is used
        type: PluginType.Macro,
        name: 'evtUnesc',
        fn: (original) => {
          return original.replaceAll(/EVT_([\w\.]+)_VALUE/gm, 'evt.$1value')
        },
      },
    ],
  },
  onLoad: ({ el, key, genRX, tags, signals, effect }) => {
    const rx = genRX()
    let target: Element | Window | Document = el
    if (tags.has('window')) target = window

    let callback = (evt?: Event) => {
      if (evt) {
        // Always prevent default on submit events (because forms)
        if (tags.has('prevent') || key === 'submit') evt.preventDefault()
        if (tags.has('stop')) evt.stopPropagation()
      }
      rx(evt)
    }

    const debounceArgs = tags.get('debounce')
    if (debounceArgs) {
      const wait = tagToMs(debounceArgs)
      const leading = tagHas(debounceArgs, 'leading', false)
      const trailing = !tagHas(debounceArgs, 'notrail', false)
      callback = debounce(callback, wait, leading, trailing)
    }

    const throttleArgs = tags.get('throttle')
    if (throttleArgs) {
      const wait = tagToMs(throttleArgs)
      const leading = !tagHas(throttleArgs, 'noleading', false)
      const trailing = tagHas(throttleArgs, 'trail', false)
      callback = throttle(callback, wait, leading, trailing)
    }

    const evtListOpts: AddEventListenerOptions = {
      capture: true,
      passive: false,
      once: false,
    }
    if (!tags.has('capture')) evtListOpts.capture = false
    if (tags.has('passive')) evtListOpts.passive = true
    if (tags.has('once')) evtListOpts.once = true

    const eventName = kebabize(key).toLowerCase()
    switch (eventName) {
      case 'load': {
        callback()
        delete el.dataset.onLoad
        return () => {}
      }
      case 'raf': {
        let rafId: number | undefined
        const raf = () => {
          callback()
          rafId = requestAnimationFrame(raf)
        }
        rafId = requestAnimationFrame(raf)

        return () => {
          if (rafId) cancelAnimationFrame(rafId)
        }
      }

      case 'signals-change': {
        onElementRemoved(el, () => {
          lastSignalsMarshalled.delete(el.id)
        })
        return effect(() => {
          const onlyRemoteSignals = tags.has('remote')
          const current = signals.JSON(false, onlyRemoteSignals)
          const last = lastSignalsMarshalled.get(el.id) || ''
          if (last !== current) {
            lastSignalsMarshalled.set(el.id, current)
            callback()
          }
        })
      }
      default: {
        const testOutside = tags.has('outside')
        if (testOutside) {
          target = document
          const cb = callback
          let called = false
          const targetOutsideCallback = (e?: Event) => {
            const targetHTML = e?.target as HTMLElement
            if (!targetHTML) return
            const isEl = el.id === targetHTML.id
            if (isEl && called) {
              called = false
            }
            if (!isEl && !called) {
              cb(e)
              called = true
            }
          }
          callback = targetOutsideCallback
        }

        target.addEventListener(eventName, callback, evtListOpts)
        return () => {
          target.removeEventListener(eventName, callback)
        }
      }
    }
  },
}
