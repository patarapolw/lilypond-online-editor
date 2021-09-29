import './style.scss'

import 'html-midi-player'
import 'codemirror/lib/codemirror.css'
import 'codemirror/theme/xq-light.css'
import 'codemirror/mode/lua/lua'
import 'codemirror/addon/edit/matchbrackets'
import 'codemirror/addon/edit/closebrackets'
import CodeMirror from 'codemirror'
import tpl from './template.ly'

const editor = CodeMirror.fromTextArea(document.querySelector('textarea')!, {
  mode: 'lua',
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

const input = {
  id: document.querySelector('input[name=id]') as HTMLInputElement,
}

const btn = {
  save: document.querySelector('button[name=save]') as HTMLButtonElement,
  template: document.querySelector(
    'button[name=template]'
  ) as HTMLButtonElement,
}

btn.template.onclick = () => {
  editor.setValue(tpl)
}

btn.save.onclick = () => {
  input.id.value = Math.random().toString(36).substr(2)
}

window.addEventListener('keydown', (evt) => {
  if (evt.ctrlKey && evt.code === 'KeyS') {
    evt.preventDefault()
    btn.save.click()
  }
})
