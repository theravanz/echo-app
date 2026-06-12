"use client";

import { useState } from "react";
import { TbCheck as Check, TbSelector as ChevronsUpDown } from "react-icons/tb";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Country {
  code: string;
  flag: string;
  name: string;
}

interface CountrySelectorProps {
  value: string;
  onChange: (value: string) => void;
  countries: Country[];
}

export function CountrySelector({ value, onChange, countries }: CountrySelectorProps) {
  const [open, setOpen] = useState(false);

  const selectedCountry = countries.find((country) => country.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[100px] justify-between h-12 bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white rounded-xl"
        >
          {selectedCountry ? (
            <span className="flex items-center gap-2">
              <span>{selectedCountry.flag}</span>
              <span>{selectedCountry.code}</span>
            </span>
          ) : (
            "Select..."
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0 bg-[#121212] border-white/10">
        <Command className="bg-transparent">
          <CommandInput placeholder="Search country..." className="text-white" />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {countries.map((country) => (
                <CommandItem
                  key={country.name}
                  value={country.name}
                  onSelect={() => {
                    onChange(country.code);
                    setOpen(false);
                  }}
                  className="text-white hover:bg-white/10 cursor-pointer"
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === country.code ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="mr-2">{country.flag}</span>
                  <span>{country.name}</span>
                  <span className="ml-auto text-white/40">{country.code}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
