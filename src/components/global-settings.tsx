

"use client"

import * as React from "react"
import { useState, useEffect } from "react"
import { useForm, useFieldArray, useForm as useFormGlobal } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Settings, Trash2, RefreshCcw } from "lucide-react"

import { getTournaments, saveGlobalSettings, rescheduleAllTournaments } from "@/app/actions"
import type { GlobalSettings as GlobalSettingsType, TournamentsState } from "@/lib/types"
import { globalSettingsSchema } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  FormField
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"


export function GlobalSettings() {
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const { toast } = useToast()

  const globalSettingsForm = useFormGlobal<GlobalSettingsType>({
    resolver: zodResolver(globalSettingsSchema),
    defaultValues: {
        startTime: "08:00",
        estimatedMatchDuration: 20,
        courts: [],
    }
  });

  // Load initial data from the "DB"
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const savedTournaments = await getTournaments();
        if (savedTournaments._globalSettings) {
            globalSettingsForm.reset(savedTournaments._globalSettings);
        }
      } catch (error) {
        console.error("Failed to load global settings from DB", error);
        toast({
          variant: "destructive",
          title: "Erro ao carregar dados",
          description: "Não foi possível carregar as configurações globais.",
        });
      } finally {
        setIsLoaded(true);
      }
    };
    fetchInitialData();
  }, [globalSettingsForm, toast]);


   const { fields, append, remove } = useFieldArray({
    control: globalSettingsForm.control,
    name: "courts",
  });

  const handleSaveGlobalSettings = async (values: GlobalSettingsType) => {
    setIsSaving(true);
    const result = await saveGlobalSettings(values);
    if(result.success) {
        toast({
            title: "Configurações Salvas!",
            description: "As configurações globais do torneio foram salvas.",
        });
    } else {
        toast({
            variant: "destructive",
            title: "Erro ao Salvar",
            description: result.error || "Não foi possível salvar as configurações globais.",
        });
    }
    setIsSaving(false);
  }

  const handleRescheduleAll = async () => {
    setIsSaving(true);
    const result = await rescheduleAllTournaments();
    if (result.success) {
      toast({
        title: "Torneio Reagendado!",
        description: "Todos os jogos foram recalculados com sucesso.",
      });
    } else {
      toast({
        variant: "destructive",
        title: "Erro ao Reagendar",
        description: result.error || "Não foi possível reagendar o torneio.",
      });
    }
    setIsSaving(false);
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const CourtSlots = ({ courtIndex }: { courtIndex: number }) => {
    const { fields: slotFields, append: appendSlot, remove: removeSlot } = useFieldArray({
        control: globalSettingsForm.control,
        name: `courts.${courtIndex}.slots`,
    });

    return (
        <div className="pl-4 border-l-2 border-muted ml-4 mt-2 space-y-2">
            {slotFields.map((slot, slotIndex) => (
                <div key={slot.id} className="flex items-center gap-2">
                    <FormField
                        control={globalSettingsForm.control}
                        name={`courts.${courtIndex}.slots.${slotIndex}.startTime`}
                        render={({ field }) => (
                            <FormItem className="flex-1">
                                <FormControl>
                                    <Input type="time" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <span className="text-muted-foreground">-</span>
                     <FormField
                        control={globalSettingsForm.control}
                        name={`courts.${courtIndex}.slots.${slotIndex}.endTime`}
                        render={({ field }) => (
                            <FormItem className="flex-1">
                                <FormControl>
                                    <Input type="time" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeSlot(slotIndex)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                </div>
            ))}
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => appendSlot({ startTime: '09:00', endTime: '18:00' })}>
                Adicionar Horário
            </Button>
        </div>
    );
};


  return (
    <div className="space-y-8">
    <Card>
        <CardHeader>
            <CardTitle className="flex items-center"><Settings className="mr-2 h-5 w-5"/>Formulário de Configurações</CardTitle>
            <CardDescription>
                Defina aqui os parâmetros que afetam todo o torneio.
            </CardDescription>
        </CardHeader>
        <CardContent>
            <Form {...globalSettingsForm}>
                <form onSubmit={globalSettingsForm.handleSubmit(handleSaveGlobalSettings)} className="space-y-6">
                     <FormField
                          control={globalSettingsForm.control}
                          name="startTime"
                          render={({ field }) => (
                              <FormItem>
                              <FormLabel>Horário de Início do Torneio</FormLabel>
                              <FormControl>
                                  <Input type="time" {...field} />
                              </FormControl>
                              <FormMessage />
                              </FormItem>
                          )}
                      />
                     <FormField
                          control={globalSettingsForm.control}
                          name="estimatedMatchDuration"
                          render={({ field }) => (
                              <FormItem>
                                  <FormLabel>Duração Estimada da Partida (min)</FormLabel>
                                  <FormControl>
                                      <Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)} />
                                  </FormControl>
                                  <FormMessage />
                              </FormItem>
                          )}
                      />
                    <div className="space-y-4">
                      <Label>Quadras e Horários Disponíveis</Label>
                      {fields.map((field, index) => (
                         <div key={field.id} className="p-4 border rounded-md space-y-2">
                           <div className="flex items-start gap-2">
                                <FormField
                                control={globalSettingsForm.control}
                                name={`courts.${index}.name`}
                                render={({ field }) => (
                                    <FormItem className="flex-1">
                                    <FormLabel>Nome da Quadra {index + 1}</FormLabel>
                                    <FormControl>
                                        <Input placeholder={`Ex: Quadra Principal`} {...field} />
                                    </FormControl>
                                    <FormMessage />
                                    </FormItem>
                                )}
                                />
                                <FormField
                                control={globalSettingsForm.control}
                                name={`courts.${index}.priority`}
                                render={({ field }) => (
                                    <FormItem>
                                    <FormLabel>Prioridade</FormLabel>
                                    <FormControl>
                                        <Input type="number" className="w-24" placeholder="Ex: 1" {...field} value={field.value ?? ''} onChange={e => field.onChange(parseInt(e.target.value, 10) || undefined)} />
                                    </FormControl>
                                    <FormMessage />
                                    </FormItem>
                                )}
                                />
                             <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="mt-8">
                                <Trash2 className="h-4 w-4 text-destructive" />
                             </Button>
                           </div>
                           <CourtSlots courtIndex={index} />
                         </div>
                      ))}
                       <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() => append({ name: `Quadra ${fields.length + 1}`, slots: [{startTime: "09:00", endTime: "18:00"}], priority: fields.length + 1 })}>
                          Adicionar Quadra
                      </Button>
                    </div>
                    <Button type="submit" disabled={isSaving} className="w-full">
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Salvar Configurações
                    </Button>
                </form>
            </Form>
        </CardContent>
    </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center"><RefreshCcw className="mr-2 h-5 w-5"/>Ações Globais</CardTitle>
          <CardDescription>
            Use estas ações para gerenciar todo o torneio de uma vez.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label>Recalcular Horários</Label>
              <p className="text-sm text-muted-foreground mt-1">
                Recalcula todos os horários de todos os jogos, em todas as categorias. Esta ação considera conflitos de jogadores que participam de múltiplas categorias. Use após cadastrar todas as categorias e duplas.
              </p>
            </div>
            <Button onClick={handleRescheduleAll} disabled={isSaving} className="w-full">
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Recalcular Horários de Todo o Torneio
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
