--!nocheck
-- RoForge — plugin Roblox Studio
-- Relie Studio à l'app RoForge (http://127.0.0.1:44777). Ce fichier ne gère que la
-- connexion et le panneau ; les outils de l'IA (plugin/core.lua) sont téléchargés depuis
-- l'app à chaque connexion, donc mis à jour sans redémarrer Studio.

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local LogService = game:GetService("LogService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local VERSION = "0.2.0"
local BASE = "http://127.0.0.1:44777"

-- Pas de connexion depuis les sessions Play (client/serveur de test) : seulement l'éditeur.
if RunService:IsRunning() then
	return
end

local clientId = HttpService:GenerateGUID(false)
local connected = false
local enabled = plugin:GetSetting("RoForgeEnabled")
if enabled == nil then
	enabled = true
end

---------------------------------------------------------------------------
-- Interface : bouton de barre d'outils + petit panneau d'état
---------------------------------------------------------------------------
local toolbar = plugin:CreateToolbar("RoForge")
local button = toolbar:CreateButton("RoForge", "Connexion à l'app RoForge", "rbxasset://textures/AnimationEditor/icon_checkmark.png")
button.ClickableWhenViewportHidden = true

local widget = plugin:CreateDockWidgetPluginGuiAsync(
	"RoForgeStatus",
	DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, false, 280, 150, 240, 120)
)
widget.Title = "RoForge"

local frame = Instance.new("Frame")
frame.Size = UDim2.fromScale(1, 1)
frame.BackgroundColor3 = Color3.fromRGB(18, 20, 28)
frame.BorderSizePixel = 0
frame.Parent = widget

local dot = Instance.new("Frame")
dot.Size = UDim2.fromOffset(12, 12)
dot.Position = UDim2.fromOffset(14, 16)
dot.BorderSizePixel = 0
dot.Parent = frame
Instance.new("UICorner", dot).CornerRadius = UDim.new(1, 0)

local title = Instance.new("TextLabel")
title.BackgroundTransparency = 1
title.Position = UDim2.fromOffset(34, 8)
title.Size = UDim2.new(1, -44, 0, 28)
title.Font = Enum.Font.GothamBold
title.TextSize = 15
title.TextXAlignment = Enum.TextXAlignment.Left
title.TextColor3 = Color3.new(1, 1, 1)
title.Parent = frame

local info = Instance.new("TextLabel")
info.BackgroundTransparency = 1
info.Position = UDim2.fromOffset(14, 40)
info.Size = UDim2.new(1, -28, 0, 44)
info.Font = Enum.Font.Gotham
info.TextSize = 12
info.TextWrapped = true
info.TextXAlignment = Enum.TextXAlignment.Left
info.TextYAlignment = Enum.TextYAlignment.Top
info.TextColor3 = Color3.fromRGB(170, 178, 200)
info.Parent = frame

local toggle = Instance.new("TextButton")
toggle.Position = UDim2.new(0, 14, 1, -40)
toggle.Size = UDim2.new(1, -28, 0, 28)
toggle.Font = Enum.Font.GothamBold
toggle.TextSize = 13
toggle.TextColor3 = Color3.new(1, 1, 1)
toggle.AutoButtonColor = true
toggle.Parent = frame
Instance.new("UICorner", toggle).CornerRadius = UDim.new(0, 6)

local lastCommand = "—"
local function refreshUi()
	if not enabled then
		dot.BackgroundColor3 = Color3.fromRGB(120, 120, 130)
		title.Text = "RoForge — en pause"
		info.Text = "Le plugin ne contacte plus l'app."
		toggle.Text = "Reprendre"
		toggle.BackgroundColor3 = Color3.fromRGB(70, 90, 220)
	elseif connected then
		dot.BackgroundColor3 = Color3.fromRGB(60, 220, 120)
		title.Text = "RoForge connecté"
		info.Text = "Dernière action de l'IA : " .. lastCommand
		toggle.Text = "Mettre en pause"
		toggle.BackgroundColor3 = Color3.fromRGB(60, 64, 80)
	else
		dot.BackgroundColor3 = Color3.fromRGB(240, 170, 40)
		title.Text = "En attente de l'app…"
		info.Text = "Lance RoForge sur ce PC : la connexion se fait toute seule."
		toggle.Text = "Mettre en pause"
		toggle.BackgroundColor3 = Color3.fromRGB(60, 64, 80)
	end
	button:SetActive(widget.Enabled)
end

button.Click:Connect(function()
	widget.Enabled = not widget.Enabled
	refreshUi()
end)
toggle.MouseButton1Click:Connect(function()
	enabled = not enabled
	plugin:SetSetting("RoForgeEnabled", enabled)
	refreshUi()
end)

---------------------------------------------------------------------------
-- Outils
---------------------------------------------------------------------------
local function request(method, path, body)
	local ok, res = pcall(function()
		return HttpService:RequestAsync({
			Url = BASE .. path,
			Method = method,
			Headers = { ["Content-Type"] = "application/json" },
			Body = body and HttpService:JSONEncode(body) or nil,
		})
	end)
	if not ok or not res.Success then
		return nil
	end
	if res.Body == "" then
		return {}
	end
	local okDecode, data = pcall(HttpService.JSONDecode, HttpService, res.Body)
	return okDecode and data or nil
end

---------------------------------------------------------------------------
-- Cœur du plugin, téléchargé depuis l'app (loadstring est interdit : ModuleScript + require)
---------------------------------------------------------------------------
local handlers = {}
local coreVersion = nil

local function loadCore()
	local data = request("GET", "/plugin/core")
	if not data or type(data.source) ~= "string" then
		return false
	end
	if data.version == coreVersion then
		return true
	end
	local module = Instance.new("ModuleScript")
	module.Name = "RoForgeCore"
	local okSet = pcall(function()
		ScriptEditorService:UpdateSourceAsync(module, function()
			return data.source
		end)
	end)
	if not okSet then
		module.Source = data.source
	end
	local okRequire, factory = pcall(require, module)
	module:Destroy()
	if not okRequire or type(factory) ~= "function" then
		warn("[RoForge] cœur du plugin invalide : " .. tostring(factory))
		return false
	end
	local ctx = {
		version = VERSION,
		status = function(text)
			lastCommand = text
			refreshUi()
		end,
	}
	local okFactory, result = pcall(factory, plugin, ctx)
	if not okFactory then
		warn("[RoForge] démarrage du cœur impossible : " .. tostring(result))
		return false
	end
	handlers = result
	coreVersion = data.version
	return true
end

---------------------------------------------------------------------------
-- Sortie de Studio → app (pour que l'IA voie les erreurs)
---------------------------------------------------------------------------
local pendingLogs = {}
LogService.MessageOut:Connect(function(message, messageType)
	if #pendingLogs < 400 and not message:find("RoForgeRun", 1, true) then
		table.insert(pendingLogs, { t = os.time(), kind = messageType.Name, text = message })
	end
end)

local function flushLogs()
	if #pendingLogs == 0 or not connected then
		return
	end
	local batch = pendingLogs
	pendingLogs = {}
	request("POST", "/plugin/logs", { client = clientId, logs = batch })
end

---------------------------------------------------------------------------
-- Boucle de connexion (long-polling)
---------------------------------------------------------------------------
local function hello()
	return request("POST", "/plugin/hello", {
		client = clientId,
		version = VERSION,
		place = game.Name,
		placeId = game.PlaceId,
		gameId = game.GameId,
	})
end

local function execute(cmd)
	local handler = handlers[cmd.op]
	local reply = { client = clientId, id = cmd.id }
	if not handler then
		reply.ok = false
		reply.error = "Commande inconnue : " .. tostring(cmd.op)
	else
		local ok, result = pcall(handler, cmd.args or {})
		reply.ok = ok
		if ok then
			reply.result = result
		else
			reply.error = tostring(result)
		end
	end
	lastCommand = tostring(cmd.op)
	refreshUi()
	request("POST", "/plugin/result", reply)
end

local alive = true
plugin.Unloading:Connect(function()
	alive = false
	if connected then
		request("POST", "/plugin/bye", { client = clientId })
	end
end)

task.spawn(function()
	while alive do
		if not enabled then
			if connected then
				request("POST", "/plugin/bye", { client = clientId })
				connected = false
				refreshUi()
			end
			task.wait(1)
		elseif not connected then
			local reply = hello()
			if reply and (reply.coreVersion == coreVersion or loadCore()) then
				connected = true
				refreshUi()
			else
				task.wait(3)
			end
		else
			flushLogs()
			local data = request("GET", "/plugin/poll?client=" .. clientId)
			if data == nil then
				connected = false
				refreshUi()
				task.wait(2)
			elseif data.reconnect then
				connected = false
			else
				if data.coreVersion and data.coreVersion ~= coreVersion then
					loadCore()
				end
				for _, cmd in ipairs(data.commands or {}) do
					task.spawn(execute, cmd)
				end
			end
		end
	end
end)

refreshUi()
