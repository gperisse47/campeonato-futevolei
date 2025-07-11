

"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"

import { getTournaments, regenerateCategory } from "@/app/actions"
import type { TournamentFormValues, TournamentsState } from "@/lib/types"
import { formSchema } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "./ui/switch"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"


const defaultFormValues: TournamentFormValues = {
  category: "",
  tournamentType: "groups",
  numberOfTeams: 0,
  numberOfGroups: 0,
  teamsPerGroupToAdvance: 2,
  teams: "",
  groupFormationStrategy: "order",
  includeThirdPlace: true,
  startTime: "",
};


export function TournamentCreator() {
  const [isLoading, setIsLoading] = useState(false)
  const [tournaments, setTournaments] = useState<TournamentsState>({ _globalSettings: { startTime: "08:00", estimatedMatchDuration: 20, courts: [{ name: 'Quadra 1', slots: [{startTime: "09:00", endTime: "18:00"}] }] } })
  const [isLoaded, setIsLoaded] = useState(false);
  const { toast } = useToast()

  const form = useForm<TournamentFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultFormValues,
  })

  // Load initial data from the "DB"
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const savedTournaments = await getTournaments();
        setTournaments(savedTournaments);
      } catch (error) {
        console.error("Failed to load tournaments from DB", error);
        toast({
          variant: "destructive",
          title: "Erro ao carregar dados",
          description: "Não foi possível carregar os torneios salvos.",
        });
      } finally {
        setIsLoaded(true);
      }
    };
    fetchInitialData();
  }, [toast]);
  
  const tournamentType = form.watch("tournamentType");
  const teamsList = form.watch("teams");

  useEffect(() => {
    const teamsArray = teamsList.split('\n').map(t => t.trim()).filter(Boolean);
    form.setValue('numberOfTeams', teamsArray.length);
  }, [teamsList, form]);


  const handleLoadCategory = (categoryName: string) => {
    if (categoryName) {
        const existingCategoryData = tournaments[categoryName];
        if (existingCategoryData) {
            form.reset(existingCategoryData.formValues);
             toast({
                title: "Categoria Carregada",
                description: `Os dados de "${categoryName}" foram carregados no formulário.`,
            });
        }
    } else {
        form.reset(defaultFormValues);
    }
  };


  useEffect(() => {
    if (tournamentType === 'doubleElimination') {
      form.setValue('includeThirdPlace', false, { shouldValidate: true });
    }
  }, [form, tournamentType]);
    
  async function onSubmit(values: TournamentFormValues) {
    setIsLoading(true);
    const categoryName = values.category;
    const isUpdate = !!tournaments[categoryName];
    
    // The regenerateCategory action now handles both creation and update without scheduling.
    const result = await regenerateCategory(categoryName, values);

    if (result.success) {
      toast({
        title: isUpdate ? "Categoria Atualizada!" : "Categoria Gerada!",
        description: `A categoria "${categoryName}" foi ${isUpdate ? 'atualizada' : 'criada'} com sucesso, sem agendamento de horários.`,
      });
      // Refresh tournaments state after saving
      const savedTournaments = await getTournaments();
      setTournaments(savedTournaments);
    } else {
       toast({
        variant: "destructive",
        title: "Erro ao Salvar",
        description: result.error || "Não foi possível salvar as alterações.",
      });
    }
    
    setIsLoading(false);
    form.reset(defaultFormValues);
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  const existingCategories = Object.keys(tournaments).filter(k => k !== '_globalSettings');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Criar/Atualizar Categoria</CardTitle>
        <CardDescription>
          Insira os detalhes para a geração de uma nova categoria ou atualize uma existente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
                <Label>Carregar Categoria Existente (Opcional)</Label>
                <div className="flex gap-2">
                <Select onValueChange={handleLoadCategory}>
                    <SelectTrigger>
                        <SelectValue placeholder="Selecione para editar..."/>
                    </SelectTrigger>
                    <SelectContent>
                        {existingCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={() => form.reset(defaultFormValues)}>Limpar</Button>
                </div>
            </div>

            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome da Categoria</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Masculino, Misto" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
                control={form.control}
                name="tournamentType"
                render={({ field }) => (
                    <FormItem className="space-y-3">
                    <FormLabel>Tipo de Torneio</FormLabel>
                    <FormControl>
                        <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        value={field.value}
                        className="flex flex-col space-y-1"
                        >
                        <div className="flex items-center space-x-3 space-y-0">
                            <RadioGroupItem value="groups" id="groups"/>
                            <Label htmlFor="groups" className="font-normal">
                            Fase de Grupos + Mata-Mata
                            </Label>
                        </div>
                        <div className="flex items-center space-x-3 space-y-0">
                            <RadioGroupItem value="singleElimination" id="singleElimination"/>
                            <Label htmlFor="singleElimination" className="font-normal">
                            Mata-Mata Simples
                            </Label>
                        </div>
                         <div className="flex items-center space-x-3 space-y-0">
                            <RadioGroupItem value="doubleElimination" id="doubleElimination"/>
                            <Label htmlFor="doubleElimination" className="font-normal">
                            Dupla Eliminação
                            </Label>
                        </div>
                        </RadioGroup>
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
                />
            
            <FormField
                control={form.control}
                name="numberOfTeams"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nº de Duplas</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)} disabled />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

            {tournamentType === "groups" && (
                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="numberOfGroups"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>Nº de Grupos</FormLabel>
                            <FormControl>
                            <Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="teamsPerGroupToAdvance"
                        render={({ field }) => (
                            <FormItem>
                            <FormLabel>Classificados por Grupo</FormLabel>
                            <FormControl>
                                <Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)} />
                            </FormControl>
                            <FormMessage />
                            </FormItem>
                        )}
                        />
                </div>
            )}
           
            <FormField
              control={form.control}
              name="teams"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Duplas (uma por linha)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Jogador A e Jogador B"
                      className="min-h-[120px] resize-y"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Use o formato: Jogador1 e Jogador2
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4">
                <FormField
                control={form.control}
                name="startTime"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel>Início (Opcional)</FormLabel>
                    <FormControl>
                        <Input type="time" {...field} />
                    </FormControl>
                    <FormDescription>
                        Início desejado da categoria.
                    </FormDescription>
                    <FormMessage />
                    </FormItem>
                )}
                />
            </div>


            <FormField
              control={form.control}
              name="groupFormationStrategy"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Estratégia de Sorteio</FormLabel>
                   <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      defaultValue={field.value}
                      className="flex flex-col space-y-1"
                    >
                      <div className="flex items-center space-x-3 space-y-0">
                          <RadioGroupItem value="order" id="order"/>
                        <Label htmlFor="order" className="font-normal">
                          Ordem (Cabeças de chave)
                        </Label>
                      </div>
                      <div className="flex items-center space-x-3 space-y-0">
                          <RadioGroupItem value="random" id="random"/>
                        <Label htmlFor="random" className="font-normal">
                          Aleatório (Sorteio)
                        </Label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="includeThirdPlace"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                  <div className="space-y-0.5">
                    <Label>Disputa de 3º Lugar</Label>
                    <FormDescription>
                      Incluir um jogo para definir o terceiro lugar.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={tournamentType === 'doubleElimination'}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex flex-col gap-4">
                <Button type="submit" disabled={isLoading} className="w-full">
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isLoading ? 'Gerando...' : 'Gerar / Atualizar Categoria'}
                </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
