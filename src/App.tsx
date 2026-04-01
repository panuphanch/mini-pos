import { useState } from "react";

type Tab = "pos" | "orders" | "settings";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("pos");

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Granny's POS</h1>
          <nav className="flex gap-2">
            <button
              onClick={() => setActiveTab("pos")}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                activeTab === "pos"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              POS
            </button>
            <button
              onClick={() => setActiveTab("orders")}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                activeTab === "orders"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              Orders
            </button>
            <button
              onClick={() => setActiveTab("settings")}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                activeTab === "settings"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              Settings
            </button>
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === "pos" && (
          <div className="text-center text-gray-500">POS tab — coming soon</div>
        )}
        {activeTab === "orders" && (
          <div className="text-center text-gray-500">
            Orders tab — coming soon
          </div>
        )}
        {activeTab === "settings" && (
          <div className="text-center text-gray-500">
            Settings tab — coming soon
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
