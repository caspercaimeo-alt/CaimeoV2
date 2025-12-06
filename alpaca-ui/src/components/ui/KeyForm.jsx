import React, { useState } from "react";

export default function KeyForm() {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [msg, setMsg] = useState("");

  async function submitKeys(e) {
    e.preventDefault();
    const res = await fetch("/set-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret }),
    });

    const data = await res.json();
    if (res.ok) {
      sessionStorage.setItem("alpaca_session", data.session_token);
      setMsg("✅ Keys accepted. Session created.");
    } else {
      setMsg("❌ Error: " + (data.detail || JSON.stringify(data)));
    }
  }

  return (
    <div style={{ textAlign: "center", marginTop: "50px" }}>
      <h2>Enter Alpaca API Credentials</h2>
      <form onSubmit={submitKeys}>
        <input
          type="text"
          placeholder="API Key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          style={{ width: "300px", padding: "10px", margin: "5px" }}
        />
        <br />
        <input
          type="password"
          placeholder="API Secret"
          value={apiSecret}
          onChange={(e) => setApiSecret(e.target.value)}
          style={{ width: "300px", padding: "10px", margin: "5px" }}
        />
        <br />
        <button
          type="submit"
          style={{
            background: "white",
            color: "black",
            border: "2px solid black",
            padding: "10px 30px",
            marginTop: "10px",
            fontSize: "16px",
          }}
        >
          Submit
        </button>
      </form>
      <p>{msg}</p>
    </div>
  );
}
