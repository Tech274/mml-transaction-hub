import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useConfig(category: string) {
  return useQuery({
    queryKey: ["config", category],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("config_master").select("key,label,sort_order")
        .eq("category", category).eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}
