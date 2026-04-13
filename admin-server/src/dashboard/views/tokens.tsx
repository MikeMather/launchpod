import type { FC } from 'hono/jsx'
import { Layout, type LayoutUser } from '../layout.js'
import type { TokenMetadata, OAuthClientMetadata } from '../../db.js'

interface TokensProps {
  user: LayoutUser
  tokens: TokenMetadata[]
  oauthClients: OAuthClientMetadata[]
}

function formatTime(iso: string | null): string {
  if (!iso) return 'Never'
  return iso.replace('T', ' ').slice(0, 19)
}

export const TokensPage: FC<TokensProps> = ({ user, tokens, oauthClients }) => (
  <Layout title="API Tokens" user={user} activePath="/admin/tokens">
    <div class="card">
      <div class="flex justify-between items-center mb-4">
        <h2>OAuth Clients (for Claude/Cursor)</h2>
        <button class="btn btn-primary" id="showOAuthGenBtn">Generate OAuth Client</button>
      </div>

      {oauthClients.length === 0 ? (
        <p class="text-muted">No OAuth clients yet. Generate one to use with Claude Desktop or Cursor.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Client ID</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {oauthClients.map((c) => (
              <tr id={`oauth-${c.id}`}>
                <td><strong>{c.label}</strong></td>
                <td class="mono" style="font-size:12px;">{c.client_id}</td>
                <td class="mono">{formatTime(c.created_at)}</td>
                <td>
                  <button class="btn btn-danger btn-sm revoke-oauth-btn" data-id={c.id}>Revoke</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>

    <div class="card" style="margin-top:24px;">
      <div class="flex justify-between items-center mb-4">
        <h2>Bearer Tokens (manual API access)</h2>
        <button class="btn btn-primary" id="showGenBtn">Generate Token</button>
      </div>

      {tokens.length === 0 ? (
        <p class="text-muted">No active tokens. Generate one to use with the MCP API manually.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Created</th>
              <th>Last Used</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr id={`token-${t.id}`}>
                <td><strong>{t.label}</strong></td>
                <td class="mono">{formatTime(t.created_at)}</td>
                <td class="mono">{formatTime(t.last_used_at)}</td>
                <td>
                  <button class="btn btn-danger btn-sm revoke-btn" data-id={t.id}>Revoke</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>

    {/* Generate OAuth Client Modal */}
    <div class="modal-overlay" id="oauthGenModal">
      <div class="modal">
        <h3 id="oauthModalTitle">Generate OAuth Client</h3>
        <div id="oauthGenForm">
          <div class="form-group">
            <label>Label</label>
            <input type="text" id="oauthLabel" placeholder="e.g. Claude Desktop" required />
          </div>
          <div class="flex gap-2">
            <button class="btn btn-primary" id="oauthGenBtn">Generate</button>
            <button class="btn btn-secondary" id="cancelOAuthGenBtn">Cancel</button>
          </div>
        </div>
        <div id="oauthGenResult" style="display:none;">
          <div class="alert alert-warning">
            Copy these credentials now. The client secret will not be shown again.
          </div>
          <div class="form-group">
            <label>Client ID</label>
            <div style="background:var(--muted);padding:12px;border-radius:8px;word-break:break-all;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--foreground);" id="clientIdValue"></div>
          </div>
          <div class="form-group">
            <label>Client Secret</label>
            <div style="background:var(--muted);padding:12px;border-radius:8px;word-break:break-all;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--foreground);" id="clientSecretValue"></div>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-primary" id="copyOAuthBtn">Copy Client ID</button>
            <button class="btn btn-primary" id="copySecretBtn">Copy Client Secret</button>
            <button class="btn btn-secondary" id="closeOAuthModalBtn">Close</button>
          </div>
        </div>
      </div>
    </div>

    {/* Generate Token Modal */}
    <div class="modal-overlay" id="genModal">
      <div class="modal">
        <h3 id="modalTitle">Generate New Token</h3>
        <div id="genForm">
          <div class="form-group">
            <label>Label</label>
            <input type="text" id="tokenLabel" placeholder="e.g. My CI Token" required />
          </div>
          <div class="flex gap-2">
            <button class="btn btn-primary" id="genBtn">Generate</button>
            <button class="btn btn-secondary" id="cancelGenBtn">Cancel</button>
          </div>
        </div>
        <div id="genResult" style="display:none;">
          <div class="alert alert-warning">
            Copy this token now. It will not be shown again.
          </div>
          <div style="background:var(--muted);padding:12px;border-radius:8px;margin:12px 0;word-break:break-all;font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--foreground);" id="tokenValue"></div>
          <div class="flex gap-2">
            <button class="btn btn-primary" id="copyBtn">Copy</button>
            <button class="btn btn-secondary" id="closeModalBtn">Close</button>
          </div>
        </div>
      </div>
    </div>

    <script dangerouslySetInnerHTML={{__html: `
      console.log('[OAuth] Script loading...');
      // OAuth Client Modal
      var oauthModal = document.getElementById('oauthGenModal');
      console.log('[OAuth] Modal element:', oauthModal);
      var showOAuthGenBtn = document.getElementById('showOAuthGenBtn');
      console.log('[OAuth] Button element:', showOAuthGenBtn);
      if (showOAuthGenBtn) {
        console.log('[OAuth] Attaching click listener');
        showOAuthGenBtn.addEventListener('click', function() {
          console.log('[OAuth] Button clicked!');
          document.getElementById('oauthGenForm').style.display = 'block';
          document.getElementById('oauthGenResult').style.display = 'none';
          document.getElementById('oauthModalTitle').textContent = 'Generate OAuth Client';
          document.getElementById('oauthLabel').value = '';
          oauthModal.classList.add('open');
        });
      } else {
        console.error('[OAuth] Button not found!');
      }
      document.getElementById('cancelOAuthGenBtn').addEventListener('click', function() {
        oauthModal.classList.remove('open');
      });
      document.getElementById('closeOAuthModalBtn').addEventListener('click', function() {
        oauthModal.classList.remove('open');
        location.reload();
      });
      document.getElementById('oauthGenBtn').addEventListener('click', async function() {
        var label = document.getElementById('oauthLabel').value.trim();
        if (!label) return;
        try {
          var res = await fetch('/admin/api/oauth-clients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: label })
          });
          var data = await res.json();
          if (data.clientId && data.clientSecret) {
            document.getElementById('oauthGenForm').style.display = 'none';
            document.getElementById('oauthGenResult').style.display = 'block';
            document.getElementById('oauthModalTitle').textContent = 'OAuth Client Generated';
            document.getElementById('clientIdValue').textContent = data.clientId;
            document.getElementById('clientSecretValue').textContent = data.clientSecret;
          }
        } catch(err) {
          alert('Failed to generate OAuth client');
        }
      });
      document.getElementById('copyOAuthBtn').addEventListener('click', function() {
        var val = document.getElementById('clientIdValue').textContent;
        navigator.clipboard.writeText(val).then(function() {
          this.textContent = 'Copied!';
          setTimeout(function(){ document.getElementById('copyOAuthBtn').textContent = 'Copy Client ID'; }, 2000);
        }.bind(this));
      });
      document.getElementById('copySecretBtn').addEventListener('click', function() {
        var val = document.getElementById('clientSecretValue').textContent;
        navigator.clipboard.writeText(val).then(function() {
          this.textContent = 'Copied!';
          setTimeout(function(){ document.getElementById('copySecretBtn').textContent = 'Copy Client Secret'; }, 2000);
        }.bind(this));
      });
      document.querySelectorAll('.revoke-oauth-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          if (!confirm('Revoke this OAuth client? This cannot be undone.')) return;
          await fetch('/admin/api/oauth-clients/' + this.dataset.id + '/revoke', { method: 'POST' });
          location.reload();
        });
      });

      // Bearer Token Modal
      var modal = document.getElementById('genModal');
      document.getElementById('showGenBtn').addEventListener('click', function() {
        document.getElementById('genForm').style.display = 'block';
        document.getElementById('genResult').style.display = 'none';
        document.getElementById('modalTitle').textContent = 'Generate New Token';
        document.getElementById('tokenLabel').value = '';
        modal.classList.add('open');
      });
      document.getElementById('cancelGenBtn').addEventListener('click', function() {
        modal.classList.remove('open');
      });
      document.getElementById('closeModalBtn').addEventListener('click', function() {
        modal.classList.remove('open');
        location.reload();
      });
      document.getElementById('genBtn').addEventListener('click', async function() {
        var label = document.getElementById('tokenLabel').value.trim();
        if (!label) return;
        try {
          var res = await fetch('/admin/api/tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: label })
          });
          var data = await res.json();
          if (data.token) {
            document.getElementById('genForm').style.display = 'none';
            document.getElementById('genResult').style.display = 'block';
            document.getElementById('modalTitle').textContent = 'Token Generated';
            document.getElementById('tokenValue').textContent = data.token;
          }
        } catch(err) {
          alert('Failed to generate token');
        }
      });
      document.getElementById('copyBtn').addEventListener('click', function() {
        var val = document.getElementById('tokenValue').textContent;
        navigator.clipboard.writeText(val).then(function() {
          document.getElementById('copyBtn').textContent = 'Copied!';
          setTimeout(function(){ document.getElementById('copyBtn').textContent = 'Copy'; }, 2000);
        });
      });
      document.querySelectorAll('.revoke-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          if (!confirm('Revoke this token? This cannot be undone.')) return;
          await fetch('/admin/api/tokens/' + this.dataset.id + '/revoke', { method: 'POST' });
          location.reload();
        });
      });
    `}}></script>
  </Layout>
)
