import type { FC } from 'hono/jsx'

interface LoginProps {
  error?: string
}

export const LoginPage: FC<LoginProps> = ({ error }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Login - Admin</title>
      <script src="https://unpkg.com/htmx.org@2.0.3"></script>
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
        .login-btn { width: 100%; padding: 12px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 8px; transition: background 0.15s, opacity 0.15s; }
        .login-btn:hover:not(:disabled) { background: #2563eb; }
        .login-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .login-btn.htmx-request { opacity: 0.7; }
        .error-msg { background: #fee2e2; color: #991b1b; padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 16px; border: 1px solid #fca5a5; }
      `}</style>
    </head>
    <body>
      <div class="login-card">
        <div class="login-brand">
          <h1><span>Launch</span>Pod</h1>
          <p>Sign in to the admin dashboard</p>
        </div>
        {error && <div class="error-msg">{error}</div>}
        <form method="post" action="/login">
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required placeholder="you@example.com" autofocus />
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required placeholder="Enter your password" />
          </div>
          <button type="submit" class="login-btn">Sign In</button>
        </form>
      </div>
    </body>
  </html>
)
