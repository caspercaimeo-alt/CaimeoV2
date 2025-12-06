import React from "react";

export function Button({ children, onClick, className = "", variant = "default" }) {
  const styles =
    variant === "outline"
      ? "border border-gray-400 text-gray-700 hover:bg-gray-100"
      : "bg-blue-600 text-white hover:bg-blue-700";

  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-xl font-semibold transition ${styles} ${className}`}
    >
      {children}
    </button>
  );
}
