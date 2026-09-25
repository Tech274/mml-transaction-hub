import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { findOrCreateCustomer } from "@/lib/transactions.functions";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface CustomerOption { id: string; customer_name: string }

export function CustomerCombobox({
  value, onChange,
}: { value: CustomerOption | null; onChange: (c: CustomerOption) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const qc = useQueryClient();
  const createFn = useServerFn(findOrCreateCustomer);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers", "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers").select("id, customer_name")
        .eq("is_active", true).order("customer_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = customers.filter((c) =>
    c.customer_name.toLowerCase().includes(search.toLowerCase()),
  );
  const exactMatch = customers.some(
    (c) => c.customer_name.toLowerCase().trim() === search.toLowerCase().trim(),
  );

  async function handleCreate() {
    try {
      const created = await createFn({ data: { customerName: search.trim() } });
      toast.success(`Customer "${created.customer_name}" added`);
      qc.invalidateQueries({ queryKey: ["customers"] });
      onChange({ id: created.id, customer_name: created.customer_name });
      setOpen(false);
      setSearch("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          {value ? value.customer_name : "Select customer…"}
          <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search or type new customer…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>
              {search.trim() ? (
                <button type="button" onClick={handleCreate} className="w-full text-left px-3 py-2 text-sm hover:bg-accent">
                  <Plus className="inline h-3.5 w-3.5 mr-2" />
                  Create "{search.trim()}"
                </button>
              ) : "No customers"}
            </CommandEmpty>
            <CommandGroup>
              {filtered.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.customer_name}
                  onSelect={() => {
                    onChange({ id: c.id, customer_name: c.customer_name });
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value?.id === c.id ? "opacity-100" : "opacity-0")} />
                  {c.customer_name}
                </CommandItem>
              ))}
              {search.trim() && !exactMatch && (
                <CommandItem onSelect={handleCreate} className="text-primary">
                  <Plus className="mr-2 h-4 w-4" />
                  Create "{search.trim()}"
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
