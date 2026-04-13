import type { FC } from 'hono/jsx'

export interface LayoutUser {
  id: string
  name?: string
  email: string
  role: string
}

interface LayoutProps {
  title: string
  user: LayoutUser
  activePath?: string
  children?: any
}

const navItems = [
  { href: '/', label: 'Home', icon: '⌂' },
  { href: '/admin/users', label: 'Users', icon: 'U' },
  { href: '/admin/tokens', label: 'Tokens', icon: 'T' },
  { href: '/admin/data', label: 'Data', icon: 'D' },
  { href: '/admin/audit', label: 'Audit Log', icon: 'A' },
  { href: '/admin/sessions', label: 'Sessions', icon: 'S' },
]

export const Layout: FC<LayoutProps> = ({ title, user, activePath, children }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title} - Admin</title>
      <script src="https://unpkg.com/htmx.org@2.0.3"></script>
      <link rel="stylesheet" href="/assets/styles.css" />
    </head>
    <body>
      <aside class="sidebar">
        <div class="sidebar-brand">
          <span>Launch</span>Pod
        </div>
        <nav class="sidebar-nav">
          {navItems.map((item) => (
            <a href={item.href} class={activePath === item.href ? 'active' : ''}>
              <span class="nav-icon">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>
        <div class="sidebar-user">
          <div class="user-name">{user.name || user.email}</div>
          <div class="user-role">{user.role}</div>
          <form method="post" action="/logout">
            <button type="submit" class="logout-btn">Log out</button>
          </form>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <h1>{title}</h1>
        </header>
        <div class="content">
          {children}
        </div>
      </div>
    </body>
  </html>
)
