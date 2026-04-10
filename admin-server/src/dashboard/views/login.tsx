import type { FC } from 'hono/jsx'

export const LoginPage: FC = () => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Login - Admin</title>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
        .login-card { background: #fff; border-radius: 12px; padding: 40px; width: 100%; max-width: 400px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
        .login-brand { text-align: center; margin-bottom: 32px; }
        .login-brand h1 { font-size: 24px; font-weight: 700; color: #0f172a; }
        .login-brand h1 span { color: #3b82f6; }
        .login-brand p { color: #64748b; font-size: 14px; margin-top: 4px; }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; font-size: 13px; font-weight: 500; color: #475569; margin-bottom: 6px; }
        .form-group input { width: 100%; padding: 10px 14px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; color: #1e293b; background: #fff; }
        .form-group input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
        .login-btn { width: 100%; padding: 12px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 8px; }
        .login-btn:hover { background: #2563eb; }
        .login-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .error-msg { background: #fee2e2; color: #991b1b; padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 16px; display: none; border: 1px solid #fca5a5; }
        .error-msg.show { display: block; }
      `}</style>
    </head>
    <body>
      <div class="login-card">
        <div class="login-brand">
          <h1><span>Launch</span>Pod</h1>
          <p>Sign in to the admin dashboard</p>
        </div>
        <div id="errorMsg" class="error-msg"></div>
        <form id="loginForm">
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required placeholder="you@example.com" />
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required placeholder="Enter your password" />
          </div>
          <button type="submit" class="login-btn" id="submitBtn">Sign In</button>
        </form>
      </div>
      <script>{`
        document.getElementById('loginForm').addEventListener('submit', async function(e) {
          e.preventDefault();
          var btn = document.getElementById('submitBtn');
          var errEl = document.getElementById('errorMsg');
          btn.disabled = true;
          errEl.className = 'error-msg';
          try {
            var res = await fetch('/admin/api/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: document.getElementById('email').value,
                password: document.getElementById('password').value
              })
            });
            var data = await res.json();
            if (data.ok) {
              window.location.href = '/';
            } else {
              errEl.textContent = data.error || 'Login failed';
              errEl.className = 'error-msg show';
            }
          } catch(err) {
            errEl.textContent = 'Network error. Please try again.';
            errEl.className = 'error-msg show';
          }
          btn.disabled = false;
        });
      `}</script>
    </body>
  </html>
)
