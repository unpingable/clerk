// SPDX-License-Identifier: Apache-2.0
import './styles/global.css';
import App from './App.svelte';
import { mount } from 'svelte';

const app = mount(App, { target: document.getElementById('app')! });

export default app;
