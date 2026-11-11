// dsh-sidebar-triptych — browser half.
//
// 把左侧栏切成三段，各插一根折叠条：
//   功能区 = nav._panelList（插件 / 自动化任务 / 上下文洞察 / 更多）
//   工作区 = div._regionArea（工作区 + 会话列表，默认展开）
//   状态区 = div._footerActions（工作区之下、底部「更多」之上的用量卡 / 番茄钟 / 远程控制）
//
// 底部 settingsArea（那行「更多」+ 账号）永远钉在最底下，不参与折叠。
//
// 状态存在 Host 侧（GET/POST /plugins/dsh-sidebar-triptych/state），并通过 SSE
// (/events) 推给所有连上来的浏览器——所以在 A 设备折叠，B 设备几秒内跟着变。
//
// 纯 DOM 增强：不注册 slot、不改 React 树；折叠靠 <html> 上的 data-dsh-tp-* 属性
// 加一条 !important 规则，React 重渲染不会把状态冲掉；折叠条被重渲染删掉时由
// MutationObserver 补回。
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-triptych',
  factory: () => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const GLOBAL_FLAG = '__DSH_SIDEBAR_TRIPTYCH__'
    const CSS_ID = 'dsh-sidebar-triptych/css'
    const PART_ATTR = 'data-dsh-tp-part'
    const HEADER_CLASS = 'dsh-tp-h'
    const API = '/plugins/dsh-sidebar-triptych'
    const KEYS = ['panels', 'region', 'foot']
    const DEFAULTS = { panels: true, region: false, foot: true } // true = 折叠
    const LABELS = {
      panels: { text: '功能区', hint: '插件 / 自动化任务 / 上下文洞察 / 更多' },
      region: { text: '工作区', hint: '工作区与会话列表' },
      foot: { text: '状态区', hint: '用量卡 / 番茄钟 / 远程控制（底部「更多」常驻）' },
    }

    const CSS_TEXT = [
      'html[data-dsh-tp-panels="1"] [data-dsh-tp-part="panels"]{display:none!important}',
      'html[data-dsh-tp-region="1"] [data-dsh-tp-part="region"]{display:none!important}',
      'html[data-dsh-tp-foot="1"] [data-dsh-tp-part="foot"]{display:none!important}',
      '[class*="_footArea"]{margin-top:auto!important}',
      '.dsh-tp-h{box-sizing:border-box;display:flex;align-items:center;gap:6px;flex:none;width:100%;min-width:0;',
      'margin:2px 0 0;padding:5px 8px;border:0;border-radius:6px;background:transparent;cursor:pointer;',
      'font:inherit;font-size:11px;font-weight:600;line-height:16px;letter-spacing:.04em;text-align:left;',
      'color:var(--dsw-alias-label-secondary,#8a8f98);user-select:none;-webkit-user-select:none}',
      '.dsh-tp-h:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));',
      'color:var(--dsw-alias-label-primary,#e6e6e6)}',
      '.dsh-tp-h:focus-visible{outline:1px solid var(--dsw-alias-border-l3,#5b8def);outline-offset:-1px}',
      '.dsh-tp-h>.dsh-tp-t{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-tp-h>.dsh-tp-c{flex:none;display:flex;align-items:center;justify-content:center;width:12px;height:12px;',
      'transition:transform .16s ease;transform:rotate(0deg)}',
      'html[data-dsh-tp-panels="1"] .dsh-tp-h[data-dsh-tp-key="panels"]>.dsh-tp-c,',
      'html[data-dsh-tp-region="1"] .dsh-tp-h[data-dsh-tp-key="region"]>.dsh-tp-c,',
      'html[data-dsh-tp-foot="1"] .dsh-tp-h[data-dsh-tp-key="foot"]>.dsh-tp-c{transform:rotate(-90deg)}',
      'html[data-dsh-tp-narrow="1"] .dsh-tp-h{display:none}',
      // 工作区展开时用宿主自带标题行上的小箭头，不再单独占一条
      'html[data-dsh-tp-region="0"] .dsh-tp-h[data-dsh-tp-key="region"]{display:none}',
      '.dsh-tp-inline{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;',
      'margin-left:2px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;padding:0}',
      '.dsh-tp-inline:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
      '.dsh-tp-inline>svg{transition:transform .16s ease}',
    ].join('')

    function injectCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + CSS_ID + '"]')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-sidebar-triptych'
      tag.dataset.pluginCss = CSS_ID
      tag.textContent = CSS_TEXT
      ;(document.head || document.documentElement).appendChild(tag)
    }

    function classMatches(el, suffix) {
      const cls = el && typeof el.className === 'string' ? el.className : ''
      if (cls === '') return false
      return new RegExp('(^|\\s)[A-Za-z0-9_-]*_' + suffix + '(\\s|$)').test(cls)
    }

    function findBySuffix(suffix) {
      const loose = document.querySelectorAll('[class*="_' + suffix + '"]')
      for (const el of loose) if (classMatches(el, suffix)) return el
      return null
    }

    function clickable(el) {
      return !!el && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && el.tagName !== 'LINK'
    }

    function start() {
      if (typeof document === 'undefined' || typeof window === 'undefined') return () => {}
      if (!window.__ModuleLoader__ || window[GLOBAL_FLAG]) return () => {}
      window[GLOBAL_FLAG] = true

      injectCss()

      let collapsed = { ...DEFAULTS }
      let rev = -1
      let narrow = false
      let disposed = false
      let es = null
      let raf = 0

      const root = document.documentElement

      function paint() {
        const effective = narrow ? { panels: false, region: false, foot: false } : collapsed
        for (const key of KEYS) root.setAttribute('data-dsh-tp-' + key, effective[key] ? '1' : '0')
        root.setAttribute('data-dsh-tp-narrow', narrow ? '1' : '0')
      }

      function applyServer(state) {
        if (!state || typeof state !== 'object') return
        if (typeof state.rev === 'number' && state.rev < rev) return
        if (typeof state.rev === 'number') rev = state.rev
        const next = { ...collapsed }
        for (const key of KEYS) {
          const value = state.collapsed && state.collapsed[key]
          if (typeof value === 'boolean') next[key] = value
        }
        collapsed = next
        paint()
      }

      async function pull() {
        try {
          const res = await fetch(API + '/state', { credentials: 'same-origin', cache: 'no-store' })
          if (res.ok) applyServer(await res.json())
        } catch {
          /* 离线：保持本地默认 */
        }
      }

      async function push() {
        try {
          const res = await fetch(API + '/state', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ collapsed }),
          })
          if (res.ok) applyServer(await res.json())
        } catch {
          /* 网络失败：本地先乐观生效，下一次 pull/SSE 会收敛 */
        }
      }

      function toggle(key) {
        if (disposed) return
        collapsed = { ...collapsed, [key]: !collapsed[key] }
        paint()
        schedule()
        push()
      }

      function openEvents() {
        if (typeof EventSource !== 'function') return
        try {
          es = new EventSource(API + '/events', { withCredentials: true })
          es.addEventListener('state', (event) => {
            try {
              applyServer(JSON.parse(event.data))
            } catch {
              /* 坏包忽略 */
            }
          })
          es.onerror = () => {
            /* EventSource 自己会重连；这里只拉一次兜底 */
            pull()
          }
        } catch {
          es = null
        }
      }

      function makeHeader(key) {
        const meta = LABELS[key]
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = HEADER_CLASS
        btn.dataset.dshTpKey = key
        btn.title = meta.hint + '（点击折叠 / 展开）'
        btn.setAttribute('aria-label', meta.text)

        const label = document.createElement('span')
        label.className = 'dsh-tp-t'
        label.textContent = meta.text

        const chevron = document.createElement('span')
        chevron.className = 'dsh-tp-c'
        chevron.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
          '<path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>'

        btn.appendChild(label)
        btn.appendChild(chevron)
        btn.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          toggle(key)
        })
        return btn
      }

      function placeHeader(key, target) {
        if (!target || !target.parentNode) return false
        const parent = target.parentNode
        const existing = []
        for (const el of document.querySelectorAll('.' + HEADER_CLASS)) {
          if (el.dataset.dshTpKey === key) existing.push(el)
        }
        let header = null
        for (const el of existing) {
          if (!header && el.parentNode === parent) header = el
          else el.remove()
        }
        if (!header) header = makeHeader(key)
        if (header.nextElementSibling !== target) parent.insertBefore(header, target)
        return true
      }

      function mark(el, part) {
        if (!el) return
        if (el.getAttribute(PART_ATTR) !== part) el.setAttribute(PART_ATTR, part)
      }

      function inlineChevron() {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'dsh-tp-inline'
        btn.title = '折叠工作区'
        btn.setAttribute('aria-label', '折叠工作区')
        btn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
          '<path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>'
        btn.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          toggle('region')
        })
        return btn
      }

      function placeInlineToggle(region) {
        const header = region ? region.querySelector('[class*="_sectionHeader"]') : null
        const existing = document.querySelector('.dsh-tp-inline')
        if (!header) {
          if (existing) existing.remove()
          return
        }
        if (existing && existing.parentNode === header) return
        if (existing) existing.remove()
        header.appendChild(inlineChevron())
      }

      function sync() {
        if (disposed) return
        const panels = findBySuffix('panelList')
        const region = findBySuffix('regionArea')
        const foot = findBySuffix('footArea')
        const footerActions = findBySuffix('footerActions')
        const settingsArea = findBySuffix('settingsArea')
        const shell = (region && region.parentElement) || (foot && foot.parentElement) || null

        // 清掉已经不存在的标记
        for (const el of document.querySelectorAll('[' + PART_ATTR + ']')) {
          if (el !== panels && el !== region && el !== footerActions) el.removeAttribute(PART_ATTR)
        }

        mark(panels, 'panels')
        mark(region, 'region')

        // 状态区：优先进 footArea 里的 footerActions；没有就按位置收 footArea 里除设置行以外的块
        let footTargets = []
        if (footerActions) {
          footTargets = [footerActions]
        } else if (foot) {
          for (const child of Array.from(foot.children)) {
            if (clickable(child) && child !== settingsArea) footTargets.push(child)
          }
        }
        for (const el of footTargets) mark(el, 'foot')

        const placed = new Set()
        if (placeHeader('panels', panels)) placed.add('panels')
        if (placeHeader('region', region)) placed.add('region')
        if (placeHeader('foot', footTargets[0])) placed.add('foot')

        // 工作区展开时，把折叠箭头并进宿主自己的「工作区」标题行，避免出现两个「工作区」
        placeInlineToggle(region)
        for (const header of document.querySelectorAll('.' + HEADER_CLASS)) {
          if (!placed.has(header.dataset.dshTpKey)) header.remove()
        }

        // 窄条（<96px）时不折叠、不显示折叠条
        const widthHost = shell
        if (widthHost) {
          const nextNarrow = widthHost.clientWidth > 0 && widthHost.clientWidth < 96
          if (nextNarrow !== narrow) {
            narrow = nextNarrow
            paint()
          }
        }
      }

      function schedule() {
        if (disposed || raf) return
        raf = (window.requestAnimationFrame || ((fn) => window.setTimeout(fn, 16)))(() => {
          raf = 0
          try {
            sync()
          } catch (error) {
            /* 保活：任何一次失败都不该影响侧栏 */
            console.warn('[dsh-sidebar-triptych]', error)
          }
        })
      }

      paint()
      schedule()
      pull()
      openEvents()

      const observer = new MutationObserver(() => schedule())
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true })

      let ro = null
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(() => schedule())
        const region = findBySuffix('regionArea')
        const shell = region && region.parentElement
        if (shell) ro.observe(shell)
      }

      // 兜底：SSE 断线 / 重渲染漏补
      const timer = window.setInterval(() => {
        try {
          sync()
        } catch {
          /* noop */
        }
      }, 2000)
      const pollTimer = window.setInterval(() => { pull() }, 20000)

      return () => {
        disposed = true
        try {
          observer.disconnect()
          if (ro) ro.disconnect()
          if (es) es.close()
          window.clearInterval(timer)
          window.clearInterval(pollTimer)
          if (raf) (window.cancelAnimationFrame || window.clearTimeout)(raf)
        } catch {
          /* noop */
        }
        for (const el of document.querySelectorAll('.' + HEADER_CLASS)) el.remove()
        for (const el of document.querySelectorAll('.dsh-tp-inline')) el.remove()
        for (const el of document.querySelectorAll('[' + PART_ATTR + ']')) el.removeAttribute(PART_ATTR)
        for (const key of KEYS) root.removeAttribute('data-dsh-tp-' + key)
        root.removeAttribute('data-dsh-tp-narrow')
        const style = document.querySelector('style[data-plugin-css="' + CSS_ID + '"]')
        if (style) style.remove()
        window[GLOBAL_FLAG] = false
      }
    }

    const inject = []

    function apply(ctx) {
      try {
        if (ctx && typeof ctx.effect === 'function') {
          ctx.effect(() => start(), 'dsh-sidebar-triptych: 三段折叠')
        } else {
          start()
        }
      } catch (error) {
        console.warn('[dsh-sidebar-triptych]', error)
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
