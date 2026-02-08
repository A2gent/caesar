import Sidebar from './Sidebar'
import './App.css'

function App() {
  return (
    <div className="app-container">
      <Sidebar />
      <div className="main-content">
        <h1>Welcome to A2gent Web App</h1>
        <p>This is the main content area.</p>
        <p>The expandable menu is on the left.</p>
      </div>
    </div>
  )
}

export default App
