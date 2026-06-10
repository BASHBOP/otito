package main

// Inventory handler (Go). Exercises cross-language symbol retrieval.

func GetInventory(sku string) map[string]int { return map[string]int{sku: 0} }

func ReserveInventory(sku string, qty int) bool { return qty > 0 }
