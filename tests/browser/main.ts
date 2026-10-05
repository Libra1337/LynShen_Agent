import { mount } from 'svelte';
import '../../src/lib/app.css';

const calls: { command: string; args: any }[] = [];
let loggedIn = new URL(location.href).searchParams.has('loggedIn');
Object.assign(window, {
  __calls: calls,
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args: any) => {
      calls.push({ command, args });
      switch (command) {
        case 'read_config': return {provider: 'monoize', models: []};
        case 'read_auth_providers': return loggedIn ? ['monoize'] : [];
        case 'list_providers': return [{id:'openai',base_url:'https://api.openai.com/v1',protocol:'responses',models:[{name:'gpt-5'}]}, {id:'openai-codex',base_url:'https://chatgpt.com/backend-api/codex',protocol:'openai-codex-responses',models:[{name:'gpt-5'}]}];
        case 'monoize_session': return {logged_in:loggedIn, session:loggedIn ? {user:{username:'Test user'}} : null};
        case 'monoize_logout': loggedIn = false; return;
        case 'monoize_oauth_start': return {user_code:'ABCDEF123456',verification_uri_complete:'https://www.lynshen.org/oauth/authorize?user_code=ABCDEF123456'};
        case 'monoize_oauth_poll': return {pending:true};
        case 'fetch_monoize_models': return {data:[]};
        case 'provider_oauth_start': return 'attempt-1';
        case 'provider_oauth_poll': return {status:'waiting',url:'https://auth.openai.com/oauth/authorize?state=test'};
        case 'fetch_monoize_balance': return {balance_infos:[]};
        default: return null;
      }
    }
  }
});
const { default: Fixture } = await import('./Regression.svelte');
mount(Fixture, {target:document.getElementById('app')!});
