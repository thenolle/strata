/** @jsxImportSource @gambrel/view */
import { mount } from '@gambrel/browser'
import { App } from './app.tsx'

const container = document.getElementById('app')
if (container === null) throw new Error('Editor container is missing')
mount(container, <App />)
