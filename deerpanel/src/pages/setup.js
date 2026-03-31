/**
 * 初始设置页面 �?deerpanel 未安装时的引�? * 自动检测环�?�?版本选择 �?一键安�?�?自动跳转
 */
import { api, invalidate } from '../lib/tauri-api.js'
import { showUpgradeModal } from '../components/modal.js'
import { toast } from '../components/toast.js'
import { setUpgrading, isMacPlatform } from '../lib/app-state.js'
import { diagnoseInstallError } from '../lib/error-diagnosis.js'
import { icon, statusIcon } from '../lib/icons.js'
import { t } from '../lib/i18n.js'

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div style="max-width:560px;margin:48px auto;text-align:center">
      <div style="margin-bottom:var(--space-lg)">
        <img src="/images/logo-brand.png" alt="DeerPanel" style="max-width:160px;width:100%;height:auto">
      </div>
      <h1 style="font-size:var(--font-size-xl);margin-bottom:var(--space-xs)">${t('setup.headerTitle')}</h1>
      <p style="color:var(--text-secondary);margin-bottom:var(--space-xl);line-height:1.6">
        ${t('setup.headerDesc')}
      </p>

      <div id="setup-steps"></div>

      <div style="margin-top:var(--space-lg)">
        <button class="btn btn-secondary btn-sm" id="btn-recheck" style="min-width:120px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="margin-right:4px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          ${t('setup.recheck')}
        </button>
      </div>
    </div>
  `

  page.querySelector('#btn-recheck').addEventListener('click', () => runDetect(page))
  runDetect(page)
  return page
}

async function runDetect(page) {
  const stepsEl = page.querySelector('#setup-steps')
  stepsEl.innerHTML = `
    <div class="stat-card loading-placeholder" style="height:48px"></div>
    <div class="stat-card loading-placeholder" style="height:48px;margin-top:8px"></div>
    <div class="stat-card loading-placeholder" style="height:48px;margin-top:8px"></div>
    <div class="stat-card loading-placeholder" style="height:48px;margin-top:8px"></div>
  `
  // 清除缓存，确保拿到最新检测结�?  invalidate('get_version_info', 'check_node', 'check_git', 'get_services_status', 'check_installation')
  // 并行检�?Node.js、Git、OpenClaw CLI、配置文�?  const [nodeRes, gitRes, clawRes, configRes, versionRes] = await Promise.allSettled([
    api.checkNode(),
    api.checkGit(),
    api.getServicesStatus(),
    api.checkInstallation(),
    api.getVersionInfo(),
  ])

  const node = nodeRes.status === 'fulfilled' ? nodeRes.value : { installed: false }
  const git = gitRes.status === 'fulfilled' ? gitRes.value : { installed: false }
  const cliOk = clawRes.status === 'fulfilled'
    && clawRes.value?.length > 0
    && clawRes.value[0]?.cli_installed !== false
  let config = configRes.status === 'fulfilled' ? configRes.value : { installed: false }
  const version = versionRes.status === 'fulfilled' ? versionRes.value : null

  // CLI 已装但配置缺�?�?自动创建默认配置
  if (cliOk && !config.installed) {
    try {
      const initResult = await api.initOpenclawConfig()
      if (initResult?.created) {
        config = await api.checkInstallation()
      }
    } catch (e) {
      console.warn('[setup] 自动初始化配置失�?', e)
    }
  }

  // Git 已安装时，自动配�?HTTPS 替代 SSH（静默执行）
  if (git.installed) {
    api.configureGitHttps().catch(() => {})
  }

  renderSteps(page, { node, git, cliOk, config, version })
}

function stepIcon(ok) {
  const color = ok ? 'var(--success)' : 'var(--text-tertiary)'
  return `<span style="color:${color};font-weight:700;width:18px;display:inline-block">${ok ? '�? : '�?}</span>`
}

function renderSteps(page, { node, git, cliOk, config, version }) {
  const stepsEl = page.querySelector('#setup-steps')
  const nodeOk = node.installed
  const gitOk = git?.installed || false
  const allOk = nodeOk && cliOk && config.installed

  let html = ''

  // 第一步：Node.js
  html += `
    <div class="config-section" style="text-align:left">
      <div class="config-section-title" style="display:flex;align-items:center;gap:4px">
        ${stepIcon(nodeOk)} ${t('setup.stepNode')}
      </div>
      ${nodeOk
        ? `<p style="color:var(--success);font-size:var(--font-size-sm)">${t('setup.installed')} ${node.version || ''}</p>`
        : `<p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm)">
            ${t('setup.stepNodeHint')}
          </p>
          <a class="btn btn-primary btn-sm" href="https://nodejs.org/" target="_blank" rel="noopener">${t('setup.downloadNode')}</a>
          <span class="form-hint" style="margin-left:8px">${t('setup.recheckAfterInstall')}</span>
          <div style="margin-top:var(--space-sm);padding:8px 12px;background:var(--bg-tertiary);border-radius:var(--radius-sm);font-size:var(--font-size-xs);color:var(--text-secondary);line-height:1.6">
            <strong>${t('setup.nodeInstalledButNotDetected')}</strong>
            ${isMacPlatform()
              ? `${t('setup.macNodeHint')}<br>
                 <code style="background:var(--bg-secondary);padding:2px 6px;border-radius:3px;user-select:all">open /Applications/DeerPanel.app</code>`
              : `${t('setup.winNodeHint')}`
            }
            <div style="margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <button class="btn btn-secondary btn-sm" id="btn-scan-node" style="font-size:11px;padding:3px 10px">${icon('search', 12)} ${t('setup.scanNodeBtn')}</button>
              <span style="color:var(--text-tertiary)">${t('setup.orManualPath')}</span>
            </div>
            <div style="margin-top:6px;display:flex;gap:6px">
              <input id="input-node-path" type="text" placeholder="${isMacPlatform() ? '/usr/local/bin' : 'F:\\\\AI\\\\Node'}"
                style="flex:1;padding:4px 8px;border:1px solid var(--border-primary);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-size:11px;font-family:monospace">
              <button class="btn btn-primary btn-sm" id="btn-check-path" style="font-size:11px;padding:3px 10px">${t('setup.checkPathBtn')}</button>
            </div>
            <div id="scan-result" style="margin-top:6px;display:none"></div>
          </div>`
      }
    </div>
  `

  // 第二步：Git
  html += `
    <div class="config-section" style="text-align:left;${nodeOk ? '' : 'opacity:0.4;pointer-events:none'}">
      <div class="config-section-title" style="display:flex;align-items:center;gap:4px">
        ${stepIcon(gitOk)} ${t('setup.stepGit')}
      </div>
      ${gitOk
        ? `<p style="color:var(--success);font-size:var(--font-size-sm)">${t('setup.installed')} ${git.version || ''}</p>
           <p style="font-size:var(--font-size-xs);color:var(--text-tertiary);margin-top:4px">�?${t('setup.gitHttpsConfigured')}</p>`
        : `<p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm);line-height:1.5">
            ${t('setup.stepGitHint')}
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" id="btn-auto-install-git">${t('setup.autoInstallGitBtn')}</button>
            <a class="btn btn-secondary btn-sm" href="https://git-scm.com/downloads" target="_blank" rel="noopener">${t('setup.manualDownload')}</a>
          </div>
          <div id="git-install-result" style="margin-top:var(--space-sm);display:none"></div>
          <div style="margin-top:8px;font-size:var(--font-size-xs);color:var(--text-tertiary);line-height:1.5">
            ${t('setup.gitOptionalHint')}
          </div>`
      }
    </div>
  `

  // 第三步：DeerPanel CLI
  html += `
    <div class="config-section" style="text-align:left;${nodeOk ? '' : 'opacity:0.4;pointer-events:none'}">
      <div class="config-section-title" style="display:flex;align-items:center;gap:4px">
        ${stepIcon(cliOk)} DeerPanel CLI
      </div>
      ${cliOk
        ? `<p style="color:var(--success);font-size:var(--font-size-sm)">${t('setup.cliAvailable')}</p>
           ${version?.ahead_of_recommended && version?.recommended
             ? `<div style="margin-top:8px;padding:8px 12px;background:var(--bg-tertiary);border-radius:var(--radius-sm);font-size:var(--font-size-xs);color:var(--warning,#f59e0b);line-height:1.6">
                  ${t('setup.cliAheadWarning', { current: version.current || '', recommended: version.recommended })}
                </div>`
             : ''}`
        : renderInstallSection()
      }
    </div>
  `
  // 第四步：配置文件 + 自定义路�?  html += `
    <div class="config-section" style="text-align:left;${cliOk ? '' : 'opacity:0.4;pointer-events:none'}">
      <div class="config-section-title" style="display:flex;align-items:center;gap:4px">
        ${stepIcon(config.installed)} ${t('setup.stepConfig')}
      </div>
      ${config.installed
        ? `<p style="color:var(--success);font-size:var(--font-size-sm)">${t('setup.configAt', { path: config.path || '' })}</p>`
        : `<p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm)">
            ${t('setup.configMissing')}
          </p>
          <button class="btn btn-primary btn-sm" id="btn-init-config">${t('setup.initConfigLabel')}</button>`
      }
      <details style="margin-top:var(--space-sm);cursor:pointer" id="custom-dir-details">
        <summary style="font-size:var(--font-size-xs);color:var(--text-secondary);font-weight:600;user-select:none">
          ${t('setup.customDirTitle')}
        </summary>
        <div style="margin-top:var(--space-sm);padding:10px 12px;background:var(--bg-tertiary);border-radius:var(--radius-sm);font-size:var(--font-size-xs);line-height:1.6">
          <p style="color:var(--text-secondary);margin-bottom:8px">
            ${t('setup.customDirHint')}
          </p>
          <div style="display:flex;gap:6px">
            <input id="input-deerpanel-dir" type="text" placeholder="${t('setup.customDirPlaceholder')}"
              style="flex:1;padding:4px 8px;border:1px solid var(--border-primary);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-size:11px;font-family:monospace">
            <button class="btn btn-primary btn-sm" id="btn-save-deerpanel-dir" style="font-size:11px;padding:3px 10px">${t('setup.saveBtn')}</button>
            <button class="btn btn-secondary btn-sm" id="btn-reset-deerpanel-dir" style="font-size:11px;padding:3px 10px">${t('setup.resetDefaultBtn')}</button>
          </div>
          <div id="deerpanel-dir-result" style="margin-top:6px;display:none"></div>
        </div>
      </details>
    </div>
  `

  // AI 助手入口
  html += `
    <div class="config-section" style="text-align:left;margin-top:var(--space-md)">
      <div class="config-section-title" style="display:flex;align-items:center;gap:6px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
        ${t('setup.aiAssistant')}
      </div>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm);line-height:1.5">
        ${t('setup.aiAssistantDesc')}${!allOk ? t('setup.aiAssistantDescProblem') : ''}�?      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="btn-goto-assistant">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="margin-right:4px"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
          ${t('setup.openAiAssistant')}
        </button>
        ${!allOk ? `<button class="btn btn-primary btn-sm" id="btn-ask-ai-help">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="margin-right:4px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          ${t('setup.askAiHelp')}
        </button>` : ''}
      </div>
    </div>
  `

  // 全部就绪 �?进入面板
  if (allOk) {
    html += `
      <div class="config-section" style="text-align:left;margin-top:var(--space-md)">
        <div class="config-section-title">${t('setup.nextStepsTitle')}</div>
        <div style="color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.7">
          ${t('setup.nextStepsDesc')}
          <ol style="margin:8px 0 0 18px;padding:0">
            <li>${t('setup.nextStep1')}</li>
            <li>${t('setup.nextStep2')}</li>
            <li>${t('setup.nextStep3')}</li>
          </ol>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn btn-secondary btn-sm" id="btn-goto-models">${t('setup.configModels')}</button>
          <button class="btn btn-secondary btn-sm" id="btn-goto-gateway">${t('setup.gatewaySetup')}</button>
          <button class="btn btn-secondary btn-sm" id="btn-goto-channels">${t('setup.messageChannels')}</button>
        </div>
      </div>
      <div style="margin-top:var(--space-lg)">
        <button class="btn btn-primary" id="btn-enter" style="min-width:200px">${t('setup.enterPanel')}</button>
      </div>
    `
  }

  stepsEl.innerHTML = html
  bindEvents(page, nodeOk, { node, git, cliOk, config })
}

function renderInstallSection() {
  const isWin = navigator.platform?.startsWith('Win') || navigator.userAgent?.includes('Windows')
  const isMac = navigator.platform?.startsWith('Mac') || navigator.userAgent?.includes('Macintosh')
  const isDesktop = !!window.__TAURI_INTERNALS__

  let envHint = ''
  if (isDesktop) {
    envHint = `
      <div style="margin-top:var(--space-sm);padding:10px 12px;background:var(--bg-tertiary);border-radius:var(--radius-sm);border-left:3px solid var(--warning);font-size:var(--font-size-xs);color:var(--text-secondary);line-height:1.7">
        <strong style="color:var(--text-primary)">${t('setup.envHintTitle')}</strong>
        <p style="margin:6px 0 2px">${t('setup.envHintDesc')}</p>
        <ul style="margin:4px 0 8px 16px;padding:0">
          ${isWin ? `
            <li><strong>${t('setup.envHintWsl')}</strong> �?${t('setup.envHintWslDesc')}</li>
            <li><strong>${t('setup.envHintDocker')}</strong> �?${t('setup.envHintDockerDesc')}</li>
          ` : ''}
          ${isMac ? `
            <li><strong>${t('setup.envHintDocker')}</strong> �?${t('setup.envHintDockerDesc')}</li>
            <li><strong>${t('setup.envHintRemote')}</strong> �?${t('setup.envHintRemoteDesc')}</li>
          ` : ''}
          ${!isWin && !isMac ? `
            <li><strong>${t('setup.envHintDocker')}</strong> �?${t('setup.envHintDockerDesc')}</li>
          ` : ''}
        </ul>
        <details style="cursor:pointer">
          <summary style="font-weight:600;color:var(--primary);margin-bottom:6px">
            ${t('setup.envHintInstallManage')}
          </summary>
          <div style="margin-top:8px">
            ${isWin ? `
              <div style="margin-bottom:10px">
                <div style="font-weight:600;margin-bottom:4px">${t('setup.wslWebHint')}</div>
                <div style="margin-bottom:2px;opacity:0.8">${t('setup.wslWebDesc')}</div>
                <code style="display:block;background:var(--bg-secondary);padding:6px 10px;border-radius:4px;user-select:all;word-break:break-all">curl -fsSL https://raw.githubusercontent.com/qingchencloud/deerpanel/main/deploy.sh | bash</code>
                <div style="margin-top:4px;opacity:0.7">${t('setup.domesticMirror')}<code style="background:var(--bg-secondary);padding:2px 4px;border-radius:3px;user-select:all">curl -fsSL https://gitee.com/QtCodeCreators/deerpanel/raw/main/deploy.sh | bash</code></div>
                <div style="margin-top:4px;opacity:0.7">${t('setup.wslWebPostDeploy')}</div>
              </div>
            ` : ''}
            <div style="margin-bottom:10px">
              <div style="font-weight:600;margin-bottom:4px">${t('setup.dockerHint')}</div>
              <div style="margin-bottom:2px;opacity:0.8">${t('setup.dockerDesc')}</div>
              <code style="display:block;background:var(--bg-secondary);padding:6px 10px;border-radius:4px;user-select:all;word-break:break-all;margin-bottom:4px">npm i -g @qingchencloud/deerpanel-zh</code>
              <code style="display:block;background:var(--bg-secondary);padding:6px 10px;border-radius:4px;user-select:all;word-break:break-all">curl -fsSL https://raw.githubusercontent.com/qingchencloud/deerpanel/main/deploy.sh | bash</code>
              <div style="margin-top:4px;opacity:0.7">${t('setup.domesticMirrorShort')}<code style="background:var(--bg-secondary);padding:2px 4px;border-radius:3px;user-select:all">curl -fsSL https://gitee.com/QtCodeCreators/deerpanel/raw/main/deploy.sh | bash</code></div>
            </div>
            <div>
              <div style="font-weight:600;margin-bottom:4px">${t('setup.remoteHint')}</div>
              <div style="margin-bottom:2px;opacity:0.8">${t('setup.remoteDesc')}</div>
              <code style="display:block;background:var(--bg-secondary);padding:6px 10px;border-radius:4px;user-select:all;word-break:break-all">curl -fsSL https://raw.githubusercontent.com/qingchencloud/deerpanel/main/deploy.sh | bash</code>
              <div style="margin-top:4px;opacity:0.7">${t('setup.domesticMirrorShort')}<code style="background:var(--bg-secondary);padding:2px 4px;border-radius:3px;user-select:all">curl -fsSL https://gitee.com/QtCodeCreators/deerpanel/raw/main/deploy.sh | bash</code></div>
            </div>
          </div>
        </details>
        <div style="margin-top:6px;opacity:0.7">
          ${t('setup.envHintLocalReinstall')}
        </div>
      </div>`
  }

  return `
    <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm)">
      ${t('setup.installHint')}
    </p>
    <p style="color:var(--text-tertiary);font-size:var(--font-size-xs);line-height:1.6;margin:-4px 0 var(--space-sm)">
      ${t('setup.installHint2')}
    </p>
    <div style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-sm)">
      <label class="setup-source-option" style="flex:1;cursor:pointer">
        <input type="radio" name="install-source" value="chinese" checked style="margin-right:6px">
        <div>
          <div style="font-weight:600;font-size:var(--font-size-sm)">${t('setup.sourceChineseLabel')}</div>
          <div style="font-size:var(--font-size-xs);color:var(--text-tertiary)">@qingchencloud/deerpanel-zh</div>
        </div>
      </label>
      <label class="setup-source-option" style="flex:1;cursor:pointer">
        <input type="radio" name="install-source" value="official" style="margin-right:6px">
        <div>
          <div style="font-weight:600;font-size:var(--font-size-sm)">${t('setup.sourceOfficialLabel')}</div>
          <div style="font-size:var(--font-size-xs);color:var(--text-tertiary)">deerpanel</div>
        </div>
      </label>
    </div>
    <div style="margin-bottom:var(--space-sm)" id="install-method-section">
      <label style="font-size:var(--font-size-xs);color:var(--text-tertiary);display:block;margin-bottom:4px">${t('setup.installMethodLabel')}</label>
      <select id="install-method" style="width:100%;padding:6px 8px;border-radius:var(--radius-sm);border:1px solid var(--border-primary);background:var(--bg-secondary);color:var(--text-primary);font-size:var(--font-size-sm)">
        <option value="auto">${t('setup.methodAuto')}</option>
        <option value="standalone-r2">${t('setup.methodStandaloneR2')}</option>
        <option value="standalone-github">${t('setup.methodStandaloneGithub')}</option>
        <option value="npm">${t('setup.methodNpm')}</option>
      </select>
      <div id="method-hint" style="font-size:var(--font-size-xs);color:var(--text-tertiary);margin-top:4px;line-height:1.5"></div>
    </div>
    <div style="margin-bottom:var(--space-sm)" id="registry-section">
      <label style="font-size:var(--font-size-xs);color:var(--text-tertiary);display:block;margin-bottom:4px">${t('setup.registryLabel')}</label>
      <select id="registry-select" style="width:100%;padding:6px 8px;border-radius:var(--radius-sm);border:1px solid var(--border-primary);background:var(--bg-secondary);color:var(--text-primary);font-size:var(--font-size-sm)">
        <option value="https://registry.npmmirror.com">${t('setup.registryTaobao')}</option>
        <option value="https://registry.npmjs.org">${t('setup.registryNpm')}</option>
        <option value="https://repo.huaweicloud.com/repository/npm/">${t('setup.registryHuawei')}</option>
      </select>
    </div>
    <button class="btn btn-primary btn-sm" id="btn-install">${t('setup.installBtn')}</button>
    ${envHint}
  `
}

function buildSetupProblemPrompt({ node, git, cliOk, config }) {
  const problems = []
  if (!node.installed) problems.push(`- ${t('setup.promptNodeMissing')}`)
  else problems.push(`- ${t('setup.promptNodeOk', { version: node.version || t('common.unknown') })}`)
  if (!git?.installed) problems.push(`- ${t('setup.promptGitMissing')}`)
  else problems.push(`- ${t('setup.promptGitOk', { version: git.version || t('common.unknown') })}`)
  if (!cliOk) problems.push(`- ${t('setup.promptCliMissing')}`)
  else problems.push(`- ${t('setup.promptCliOk')}`)
  if (!config.installed) problems.push(`- ${t('setup.promptConfigMissing')}`)
  else problems.push(`- ${t('setup.promptConfigOk', { path: config.path || '' })}`)

  return `${t('setup.promptIntro')}

${problems.join('\n')}

${t('setup.promptOutro')}`
}

function bindEvents(page, nodeOk, detectState) {
  // 打开 AI 助手
  page.querySelector('#btn-goto-assistant')?.addEventListener('click', () => {
    window.location.hash = '/assistant'
  })

  // �?AI 帮我解决（带问题上下文）
  page.querySelector('#btn-ask-ai-help')?.addEventListener('click', () => {
    if (detectState) {
      const prompt = buildSetupProblemPrompt(detectState)
      sessionStorage.setItem('assistant-auto-prompt', prompt)
    }
    window.location.hash = '/assistant'
  })

  // 进入面板
  page.querySelector('#btn-enter')?.addEventListener('click', () => {
    window.location.hash = '/dashboard'
  })
  page.querySelector('#btn-goto-models')?.addEventListener('click', () => {
    window.location.hash = '/models'
  })
  page.querySelector('#btn-goto-gateway')?.addEventListener('click', () => {
    window.location.hash = '/gateway'
  })
  page.querySelector('#btn-goto-channels')?.addEventListener('click', () => {
    window.location.hash = '/channels'
  })

  // 一键安�?Git
  page.querySelector('#btn-auto-install-git')?.addEventListener('click', async () => {
    const btn = page.querySelector('#btn-auto-install-git')
    const resultEl = page.querySelector('#git-install-result')
    btn.disabled = true
    btn.textContent = t('setup.installingGit')
    if (resultEl) {
      resultEl.style.display = 'block'
      resultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('setup.gitInstallingHint')}</span>`
    }
    try {
      const msg = await api.autoInstallGit()
      if (resultEl) resultEl.innerHTML = `<span style="color:var(--success)">�?${msg}</span>`
      toast(t('setup.gitInstallSuccess'), 'success')
      // 安装成功后自动配�?HTTPS
      api.configureGitHttps().catch(() => {})
      setTimeout(() => runDetect(page), 1000)
    } catch (e) {
      const errMsg = String(e.message || e)
      if (resultEl) {
        resultEl.innerHTML = `<div>
          <span style="color:var(--danger)">${t('setup.gitAutoInstallFailed', { err: errMsg })}</span>
          <p style="margin-top:6px;font-size:var(--font-size-xs);color:var(--text-secondary);line-height:1.5">
            ${t('setup.gitManualHint')}<br>
            ${t('setup.gitManualInstallHtml')}
          </p>
        </div>`
      }
      toast(t('setup.gitAutoInstallFailedToast'), 'warning')
    } finally {
      btn.disabled = false
      btn.textContent = t('setup.autoInstallGitBtn')
    }
  })

  // 自定�?DeerPanel 安装路径
  const dirInput = page.querySelector('#input-deerpanel-dir')
  const dirResultEl = page.querySelector('#deerpanel-dir-result')
  // 预填当前自定义路�?  if (dirInput) {
    api.getOpenclawDir().then(info => {
      if (info.isCustom) {
        dirInput.value = info.path
        // 已有自定义路径时自动展开
        const details = page.querySelector('#custom-dir-details')
        if (details) details.open = true
      }
    }).catch(() => {})
  }

  page.querySelector('#btn-save-deerpanel-dir')?.addEventListener('click', async () => {
    const value = dirInput?.value?.trim()
    if (!value) { toast(t('setup.enterPath'), 'warning'); return }
    const btn = page.querySelector('#btn-save-deerpanel-dir')
    btn.disabled = true
    if (dirResultEl) { dirResultEl.style.display = 'block'; dirResultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('setup.saving')}</span>` }
    try {
      const cfg = await api.readPanelConfig()
      cfg.deerpanelDir = value
      await api.writePanelConfig(cfg)
      invalidate()
      if (dirResultEl) dirResultEl.innerHTML = `<span style="color:var(--success)">�?${t('setup.pathSaved')}</span>`
      toast(t('setup.customPathSaved'), 'success')
      setTimeout(() => runDetect(page), 500)
    } catch (e) {
      if (dirResultEl) dirResultEl.innerHTML = `<span style="color:var(--error)">${t('setup.saveFailed', { err: e })}</span>`
      toast(t('setup.saveFailed', { err: e }), 'error')
    } finally {
      btn.disabled = false
    }
  })

  page.querySelector('#btn-reset-deerpanel-dir')?.addEventListener('click', async () => {
    const btn = page.querySelector('#btn-reset-deerpanel-dir')
    btn.disabled = true
    try {
      const cfg = await api.readPanelConfig()
      delete cfg.deerpanelDir
      await api.writePanelConfig(cfg)
      invalidate()
      if (dirInput) dirInput.value = ''
      if (dirResultEl) { dirResultEl.style.display = 'block'; dirResultEl.innerHTML = `<span style="color:var(--success)">�?${t('setup.defaultRestored')}</span>` }
      toast(t('setup.defaultRestoredToast'), 'success')
      setTimeout(() => runDetect(page), 500)
    } catch (e) {
      toast(t('setup.restoreFailed', { err: e }), 'error')
    } finally {
      btn.disabled = false
    }
  })

  // 一键初始化配置
  page.querySelector('#btn-init-config')?.addEventListener('click', async () => {
    const btn = page.querySelector('#btn-init-config')
    btn.disabled = true
    btn.textContent = t('setup.initializing')
    try {
      const result = await api.initOpenclawConfig()
      if (result?.created) {
        toast(t('setup.configCreated'), 'success')
      } else {
        toast(result?.message || t('setup.configExists'), 'info')
      }
      setTimeout(() => runDetect(page), 500)
    } catch (e) {
      toast(t('setup.initFailed', { err: e }), 'error')
      btn.disabled = false
      btn.textContent = t('setup.initConfigLabel')
    }
  })

  // 自动扫描 Node.js
  page.querySelector('#btn-scan-node')?.addEventListener('click', async () => {
    const btn = page.querySelector('#btn-scan-node')
    const resultEl = page.querySelector('#scan-result')
    btn.disabled = true
    btn.textContent = t('setup.scanning')
    resultEl.style.display = 'block'
    resultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('setup.scanningPaths')}</span>`
    try {
      const results = await api.scanNodePaths()
      if (results.length === 0) {
        resultEl.innerHTML = `<span style="color:var(--warning)">${t('setup.scanNotFound')}</span>`
      } else {
        resultEl.innerHTML = results.map(r =>
          `<div style="display:flex;align-items:center;gap:6px;margin-top:4px">
            <span style="color:var(--success)">�?/span>
            <code style="flex:1;background:var(--bg-secondary);padding:2px 6px;border-radius:3px;font-size:11px">${r.path}</code>
            <span style="font-size:11px;color:var(--text-tertiary)">${r.version}</span>
            <button class="btn btn-primary btn-sm btn-use-path" data-path="${r.path}" style="font-size:10px;padding:2px 8px">${t('setup.scanUseBtn')}</button>
          </div>`
        ).join('')
        resultEl.querySelectorAll('.btn-use-path').forEach(b => {
          b.addEventListener('click', async () => {
            await api.saveCustomNodePath(b.dataset.path)
            toast(t('setup.nodeSaved'), 'success')
            setTimeout(() => runDetect(page), 300)
          })
        })
      }
    } catch (e) {
      resultEl.innerHTML = `<span style="color:var(--danger)">${t('setup.scanFailed', { err: e })}</span>`
    } finally {
      btn.disabled = false
      btn.innerHTML = `${icon('search', 12)} ${t('setup.scanNodeBtn')}`
    }
  })

  // 手动指定路径检�?  page.querySelector('#btn-check-path')?.addEventListener('click', async () => {
    const input = page.querySelector('#input-node-path')
    const resultEl = page.querySelector('#scan-result')
    const dir = input?.value?.trim()
    if (!dir) { toast(t('setup.enterNodeDir'), 'warning'); return }
    resultEl.style.display = 'block'
    resultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('setup.detecting2')}</span>`
    try {
      const result = await api.checkNodeAtPath(dir)
      if (result.installed) {
        await api.saveCustomNodePath(dir)
        resultEl.innerHTML = `<span style="color:var(--success)">�?${t('setup.nodeFoundSaved', { version: result.version })}</span>`
        toast(t('setup.nodeSaved'), 'success')
        setTimeout(() => runDetect(page), 300)
      } else {
        resultEl.innerHTML = `<span style="color:var(--warning)">${t('setup.nodeNotFoundAtPath')}</span>`
      }
    } catch (e) {
      resultEl.innerHTML = `<span style="color:var(--danger)">${t('setup.checkFailed', { err: e })}</span>`
    }
  })

  // 安装方式联动：源切换时更新方式选项可见�?  const methodSection = page.querySelector('#install-method-section')
  const registrySection = page.querySelector('#registry-section')
  const methodSelect = page.querySelector('#install-method')
  const methodHint = page.querySelector('#method-hint')
  const sourceRadios = page.querySelectorAll('input[name="install-source"]')

  const METHOD_HINTS = {
    'auto': t('setup.methodHintAuto'),
    'standalone-r2': t('setup.methodHintR2'),
    'standalone-github': t('setup.methodHintGithub'),
    'npm': t('setup.methodHintNpm'),
  }

  function updateMethodVisibility() {
    const source = page.querySelector('input[name="install-source"]:checked')?.value || 'chinese'
    if (source === 'official') {
      if (methodSection) methodSection.style.display = 'none'
      if (registrySection) registrySection.style.display = ''
    } else {
      if (methodSection) methodSection.style.display = ''
      const method = methodSelect?.value || 'auto'
      if (registrySection) registrySection.style.display = (method === 'npm') ? '' : 'none'
    }
    if (methodHint && methodSelect) methodHint.textContent = METHOD_HINTS[methodSelect.value] || ''
  }

  sourceRadios.forEach(r => r.addEventListener('change', updateMethodVisibility))
  if (methodSelect) methodSelect.addEventListener('change', updateMethodVisibility)
  updateMethodVisibility()

  // 一键安�?  const installBtn = page.querySelector('#btn-install')
  if (!installBtn || !nodeOk) return

  installBtn.addEventListener('click', async () => {
    const source = page.querySelector('input[name="install-source"]:checked')?.value || 'chinese'
    const method = (source === 'official') ? 'npm' : (page.querySelector('#install-method')?.value || 'auto')
    const registry = page.querySelector('#registry-select')?.value
    const modal = showUpgradeModal(t('setup.installOpenclaw'))
    let unlistenLog, unlistenProgress

    setUpgrading(true)

    const cleanup = () => {
      setUpgrading(false)
      unlistenLog?.()
      unlistenProgress?.()
      unlistenDone?.()
      unlistenError?.()
    }

    let unlistenDone, unlistenError

    try {
      if (window.__TAURI_INTERNALS__) {
        const { listen } = await import('@tauri-apps/api/event')
        unlistenLog = await listen('upgrade-log', (e) => modal.appendLog(e.payload))
        unlistenProgress = await listen('upgrade-progress', (e) => modal.setProgress(e.payload))

        // 后台任务完成：继续安�?Gateway + 自动配置
        unlistenDone = await listen('upgrade-done', async (e) => {
          cleanup()
          modal.setDone(typeof e.payload === 'string' ? e.payload : t('setup.installComplete'))

          // 安装成功后自动安�?Gateway
          modal.appendLog(t('setup.installingGateway'))
          try {
            await api.installGateway()
            modal.appendHtmlLog(`${statusIcon('ok', 14)} ${t('setup.gatewayInstalled')}`)
          } catch (ge) {
            modal.appendHtmlLog(`${statusIcon('warn', 14)} ${t('setup.gatewayInstallFailed', { err: ge })}`)
          }

          // 确保 deerpanel.json 有关键默认�?          try {
            const config = await api.readOpenclawConfig()
            if (config) {
              let patched = false
              if (!config.gateway) config.gateway = {}
              if (!config.gateway.mode) {
                config.gateway.mode = 'local'
                patched = true
                modal.appendHtmlLog(`${statusIcon('ok', 14)} ${t('setup.gwModeSet')}`)
              }
              if (!config.tools || config.tools.profile !== 'full') {
                config.tools = { profile: 'full', sessions: { visibility: 'all' }, ...(config.tools || {}) }
                config.tools.profile = 'full'
                if (!config.tools.sessions) config.tools.sessions = {}
                config.tools.sessions.visibility = 'all'
                patched = true
                modal.appendHtmlLog(`${statusIcon('ok', 14)} ${t('setup.toolsFullEnabled')}`)
              }
              if (patched) await api.writeOpenclawConfig(config)
            }
          } catch (ce) {
            modal.appendHtmlLog(`${statusIcon('warn', 14)} ${t('setup.autoConfigFailed', { err: ce })}`)
          }

          toast(t('setup.installSuccess'), 'success')
          setTimeout(() => window.location.reload(), 1500)
        })

        // 后台任务失败
        unlistenError = await listen('upgrade-error', async (e) => {
          cleanup()
          const errStr = String(e.payload || t('common.unknown'))
          modal.appendLog(errStr)
          await new Promise(r => setTimeout(r, 150))
          const fullLog = modal.getLogText() + '\n' + errStr
          const diagnosis = diagnoseInstallError(fullLog)
          modal.setError(diagnosis.title)
          if (diagnosis.hint) modal.appendLog('')
          if (diagnosis.hint) modal.appendHtmlLog(`${statusIcon('info', 14)} ${diagnosis.hint}`)
          if (diagnosis.command) modal.appendHtmlLog(`${icon('clipboard', 14)} ${diagnosis.command}`)
          if (window.__openAIDrawerWithError) {
            window.__openAIDrawerWithError({ title: diagnosis.title, error: fullLog, scene: t('setup.installScene'), hint: diagnosis.hint })
          }
        })

        // 先设置镜像源
        if (registry) {
          modal.appendLog(t('setup.setRegistry', { url: registry }))
          try { await api.setNpmRegistry(registry) } catch {}
        }

        // 发起后台任务（立即返回）
        await api.upgradeOpenclaw(source, null, method)
        modal.appendLog(t('setup.bgTaskStarted'))
      } else {
        // Web 模式：同步等�?        modal.appendLog(t('setup.webModeLogHint'))
        if (registry) {
          modal.appendLog(t('setup.setRegistry', { url: registry }))
          try { await api.setNpmRegistry(registry) } catch {}
        }
        const msg = await api.upgradeOpenclaw(source, null, method)
        modal.setDone(msg)
        toast(t('setup.installSuccess'), 'success')
        setTimeout(() => window.location.reload(), 1500)
        cleanup()
      }
    } catch (e) {
      cleanup()
      const errStr = String(e)
      modal.appendLog(errStr)
      const fullLog = modal.getLogText() + '\n' + errStr
      const diagnosis = diagnoseInstallError(fullLog)
      modal.setError(diagnosis.title)
    }
  })
}

