import 'codemirror/lib/codemirror.css'
import 'codemirror/theme/xq-light.css'
import 'codemirror/mode/lua/lua'
import 'codemirror/addon/edit/matchbrackets'
import 'codemirror/addon/edit/closebrackets'
import 'codemirror/addon/mode/multiplex'

import './style.scss'

import CodeMirror from 'codemirror'

import tpl from './template.ly'

CodeMirror.defineMode('lilypond', (cfg) =>
  CodeMirror.multiplexingMode(CodeMirror.getMode(cfg, 'lua'), {
    open: "'",
    close: ' ',
    mode: CodeMirror.getMode(cfg, 'text/plain'),
    delimStyle: 'delimit',
  })
)

const editor = CodeMirror.fromTextArea(document.querySelector('textarea')!, {
  mode: 'lilypond',
  extraKeys: {
    Tab: (cm) => cm.execCommand('indentMore'),
    'Shift-Tab': (cm) => cm.execCommand('indentLess'),
  },
  matchBrackets: true,
  autoCloseBrackets: true,
  lineWrapping: true,
  lineNumbers: true,
  theme: 'xq-light',
})
editor.setSize('100%', '100%')

const link = {
  url: document.querySelector('#url a') as HTMLAnchorElement,
}

const iframe = document.querySelector('iframe')!
const midiPlayer = document.querySelector('audio') as HTMLAudioElement

const input = {
  id: document.querySelector('input[name=id]') as HTMLInputElement,
}

const btn = {
  save: document.querySelector('button[name=save]') as HTMLButtonElement,
  template: document.querySelector(
    'button[name=template]'
  ) as HTMLButtonElement,
}

const pre = {
  console: document.querySelector('pre#console') as HTMLPreElement,
}

btn.template.onclick = () => {
  editor.setValue(tpl)
}

btn.save.onclick = async () => {
  const { body } = await fetch('/api/save', {
    method: 'POST',
    body: JSON.stringify({
      id: input.id.value,
      data: editor.getValue(),
    }),
    headers: {
      'Content-Type': 'application/json',
    },
  })

  const reader = body!.getReader()
  var enc = new TextDecoder('utf-8')
  pre.console.textContent = ''

  while (true) {
    const r = await reader.read()
    if (r.done) {
      break
    }

    pre.console.innerText += enc.decode(r.value)

    const m = /\nid=(.+)\n/.exec(pre.console.innerText)
    if (m && m[1]) {
      setID(m[1])
    }
  }
}

window.addEventListener('keydown', (evt) => {
  if (evt.ctrlKey && evt.code === 'KeyS') {
    evt.preventDefault()
    btn.save.click()
  }
})

const id = new URL(location.href).searchParams.get('id') || input.id.value

if (id) {
  setID(id)
  setValue(id)
} else {
  editor.setValue(tpl)
}

function setID(id: string) {
  input.id.value = id
  link.url.href = `/f/${id}`

  const setSrcIfChanged = (o: { src: string }, url: string) => {
    if (o.src !== url) {
      o.src = url
    }
  }

  setSrcIfChanged(
    iframe,
    `/pdf.js/web/viewer.html?file=${encodeURIComponent(
      `/f/${id}.pdf`
    )}#pagemode=none`
  )
  setSrcIfChanged(midiPlayer, `/f/${id}.wav`)
}

async function setValue(id: string) {
  editor.setValue(await fetch(`/f/${id}.ly`).then((r) => r.text()))
}
