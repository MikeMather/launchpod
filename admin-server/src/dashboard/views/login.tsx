import type { FC } from 'hono/jsx'

interface LoginProps {
  error?: string
}

export const LoginPage: FC<LoginProps> = ({ error }) => (
  <html lang="en" class="login-page">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Login - Admin</title>
      <link rel="stylesheet" href="/assets/styles.css" />
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
