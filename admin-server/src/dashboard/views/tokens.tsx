import type { FC } from 'hono/jsx'
import { Layout, type LayoutUser } from '../layout.js'
import type { TokenMetadata } from '../../db.js'

interface TokensProps {
  user: LayoutUser
  tokens: TokenMetadata[]
}

function formatTime(iso: string | null): string {
  if (!iso) return 'Never'
  return iso.replace('T', ' ').slice(0, 19)
}

export const TokensPage: FC<TokensProps> = ({ user, tokens }) => (
  <Layout title="API Tokens" user={user} activePath="/admin/tokens">
    <div class="card">
      <div class="flex justify-between items-center mb-4">
        <h2>Your Tokens</h2>
        <button class="btn btn-primary" id="showGenBtn">Generate Token</button>
      </div>

      {tokens.length === 0 ? (
        <p class="text-muted">No active tokens. Generate one to use with the MCP API.</p>
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
          <div style="background:#f1f5f9;padding:12px;border-radius:6px;margin:12px 0;word-break:break-all;font-family:monospace;font-size:13px;" id="tokenValue"></div>
          <div class="flex gap-2">
            <button class="btn btn-primary" id="copyBtn">Copy</button>
            <button class="btn btn-secondary" id="closeModalBtn">Close</button>
          </div>
        </div>
      </div>
    </div>

    <script>{`
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
    `}</script>
  </Layout>
)
