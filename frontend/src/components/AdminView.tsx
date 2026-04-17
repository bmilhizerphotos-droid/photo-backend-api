import React, { useEffect, useState } from "react";
import { AdminUser, fetchAdminUsers, toggleUserApproval } from "../api";

const ADMIN_EMAIL = "bmilhizerphotos@gmail.com";

export default function AdminView() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminUsers()
      .then(setUsers)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async (uid: string, currentApproval: boolean) => {
    setToggling(uid);
    try {
      await toggleUserApproval(uid, !currentApproval);
      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, isApproved: !currentApproval } : u))
      );
    } catch {
      alert("Failed to update approval status.");
    } finally {
      setToggling(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin mr-2" />
        Loading users…
      </div>
    );
  }

  if (error) {
    return <div className="text-red-600 py-4">Error: {error}</div>;
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">User Management</h2>
      <p className="text-sm text-gray-500 mb-4">{users.length} user{users.length !== 1 ? "s" : ""} registered</p>
      {users.length === 0 ? (
        <div className="text-gray-400 py-8 text-center">No users have signed in yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Seen</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr key={u.uid} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.email}</td>
                  <td className="px-4 py-3 text-gray-500">{u.displayName || "—"}</td>
                  <td className="px-4 py-3">
                    {u.email === ADMIN_EMAIL ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                        Admin
                      </span>
                    ) : u.isApproved ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        Approved
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {u.lastSeen ? new Date(u.lastSeen + "Z").toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {u.createdAt ? new Date(u.createdAt + "Z").toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {u.email !== ADMIN_EMAIL && (
                      <button
                        onClick={() => handleToggle(u.uid, u.isApproved)}
                        disabled={toggling === u.uid}
                        className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          u.isApproved
                            ? "border-red-200 text-red-600 hover:bg-red-50"
                            : "border-green-200 text-green-600 hover:bg-green-50"
                        }`}
                      >
                        {toggling === u.uid ? "…" : u.isApproved ? "Revoke" : "Approve"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
