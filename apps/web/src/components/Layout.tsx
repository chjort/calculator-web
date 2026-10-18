import type { ReactNode } from "react";

/** R1 page shell: header (right slot for R2 menus) and one main landmark. */
export function Layout({ headerRight, children }: { headerRight?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="header">
        <span className="app-name">Calculator</span>
        {headerRight && <div className="header-right">{headerRight}</div>}
      </header>
      <main className="main">{children}</main>
    </>
  );
}
