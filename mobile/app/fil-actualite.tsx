import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import * as api from "@/api";
import type { FeedItem } from "@/api";
import { ms } from "@/responsive";

function formatWhen(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTitle(item: FeedItem): string {
  const details = item.details as Record<string, unknown> | undefined;
  switch (item.action) {
    case "create_folder":
      return `Nouveau dossier : ${String(details?.name ?? details?.folder_name ?? "—")}`;
    case "rename_folder":
      return `Dossier renommé : ${String(details?.oldName ?? "—")} → ${String(details?.newName ?? "—")}`;
    case "move_folder":
      return `Dossier déplacé : ${String(details?.source ?? "—")}`;
    case "upload_file":
      return `Nouveau fichier : ${String(details?.name ?? "—")}`;
    case "create_link":
      return `Nouveau lien : ${String(details?.label ?? details?.url ?? "—")}`;
    case "user_suspended":
      return "Compte suspendu";
    case "user_restored":
      return "Compte réactivé";
    default:
      return item.action;
  }
}

function formatSubtitle(item: FeedItem): string {
  const who = [item.actor_name, item.actor_prenoms].filter(Boolean).join(" ").trim();
  const by = who || item.actor_identifiant || "Système";
  const dir = item.direction_name ? ` • ${item.direction_name}` : "";
  const when = item.created_at ? ` • ${formatWhen(item.created_at)}` : "";
  return `Par ${by}${dir}${when}`;
}

export default function FilActualiteScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!token) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const res = await api.listFeed(token, { limit: 80 });
    if (res.ok) {
      setItems(res.items);
    } else if (res.forbidden) {
      setError("Accès refusé.");
    } else if (res.networkError) {
      setError("Erreur réseau.");
    } else {
      setError("Erreur lors du chargement.");
    }
    setLoading(false);
    setRefreshing(false);
  }, [token]);

  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }
    load(false);
  }, [token, router, load]);

  const empty = useMemo(() => !loading && items.length === 0 && !error, [loading, items.length, error]);

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <View
        style={{
          paddingHorizontal: ms(16),
          paddingTop: ms(14),
          paddingBottom: ms(10),
          borderBottomWidth: 1,
          borderBottomColor: "#eee",
          flexDirection: "row",
          alignItems: "center",
          gap: ms(10),
        }}
      >
        <TouchableOpacity onPress={() => router.back()} style={{ padding: ms(6) }}>
          <Ionicons name="chevron-back" size={ms(20)} color="#0a0a0a" />
        </TouchableOpacity>
        <Text style={{ fontSize: ms(18), fontWeight: "700", color: "#0a0a0a" }}>
          Fil d’actualité
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color="#0a0a0a" />
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: ms(20) }}>
          <Text style={{ color: "#dc2626", fontWeight: "700", marginBottom: ms(10) }}>
            {error}
          </Text>
          <TouchableOpacity
            onPress={() => load(false)}
            style={{
              backgroundColor: "#0a0a0a",
              paddingVertical: ms(10),
              paddingHorizontal: ms(14),
              borderRadius: ms(10),
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : empty ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: ms(20) }}>
          <Text style={{ color: "#666" }}>Aucune activité pour le moment.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
          }
          contentContainerStyle={{ padding: ms(16), gap: ms(10) }}
          renderItem={({ item }) => (
            <View
              style={{
                borderWidth: 1,
                borderColor: "#eee",
                borderRadius: ms(14),
                padding: ms(14),
                backgroundColor: "#fff",
              }}
            >
              <Text style={{ fontWeight: "800", color: "#0a0a0a", marginBottom: ms(6) }}>
                {formatTitle(item)}
              </Text>
              <Text style={{ color: "#666" }}>{formatSubtitle(item)}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

