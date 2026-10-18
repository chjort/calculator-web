import { Calculator } from "./Calculator";

export function App() {
  return (
    <>
      <header className="header"><span className="app-name">Calculator</span></header>
      <main className="main">
        <h1 className="visually-hidden">Calculator</h1>
        <Calculator />
      </main>
    </>
  );
}
