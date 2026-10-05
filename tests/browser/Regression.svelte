<script lang="ts">
  import SettingsPage from '../../src/lib/settings/SettingsPage.svelte';
  import { SessionStore } from '../../src/lib/session.svelte';
  import { setLocale } from '../../src/lib/i18n';
  setLocale('zh');
  const sessions = new SessionStore();
  const sessionMap = $derived(new Map(sessions.allSessions.map(s => [s.id,s])));
  let welcome = $state(false);
  let section = $state('account');
  let sequence = 0;
  const projectMode = new URL(location.href).searchParams.has('projects');
</script>
{#if projectMode}
  <button onclick={() => sessions.createProject(`C:/test/project-${sequence++}`)}>新项目</button>
  <button onclick={() => sessions.activeProject && sessions.addSession(sessions.activeProject)}>新会话</button>
  <p data-testid="session">{sessionMap.get(sessions.activeId)?.draft ? '草稿已就绪' : '该对话已关闭'}</p>
  <p data-testid="count">{sessionMap.size}</p>
{:else if welcome}
  <h1>欢迎页</h1>
{:else}
  <SettingsPage sessionId="draft-test" navWidth={250} bind:section onClose={() => {}} onAccountLogout={() => {welcome = true;}} />
{/if}
