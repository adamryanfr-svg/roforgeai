--!nocheck
-- RoForge — cœur du plugin : outils de l'IA (arbre, scripts, Luau, sauvegardes, test de jeu).
-- Téléchargé depuis l'app à chaque connexion : mis à jour sans redémarrer Studio.
return function(plugin, ctx)
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local ServerStorage = game:GetService("ServerStorage")

-- "Workspace.Map.Part", "game/Workspace/Map", "ReplicatedStorage.Modules" ...
local function resolve(path)
	if path == nil or path == "" or path == "game" then
		return game
	end
	local parts = string.split((path:gsub("/", ".")), ".")
	local node = game
	local startIndex = 1
	if parts[1] == "game" then
		startIndex = 2
	end
	for i = startIndex, #parts do
		local name = parts[i]
		if name ~= "" then
			local child = node:FindFirstChild(name)
			if not child and node == game then
				local ok, service = pcall(game.GetService, game, name)
				child = ok and service or nil
			end
			if not child then
				error("Introuvable : " .. table.concat(parts, ".", startIndex, i))
			end
			node = child
		end
	end
	return node
end

local function pathOf(inst)
	if inst == game then
		return "game"
	end
	return inst:GetFullName()
end

local function describe(inst, depth, maxChildren, out, indent)
	local count = #inst:GetChildren()
	local line = string.rep("  ", indent) .. inst.Name .. " [" .. inst.ClassName .. "]"
	if count > 0 and depth <= 0 then
		line ..= " (" .. count .. " enfants)"
	end
	table.insert(out, line)
	if depth > 0 then
		local children = inst:GetChildren()
		for i, child in ipairs(children) do
			if i > maxChildren then
				table.insert(out, string.rep("  ", indent + 1) .. "… +" .. (#children - maxChildren) .. " autres")
				break
			end
			describe(child, depth - 1, maxChildren, out, indent + 1)
		end
	end
end

local COMMON_PROPS = {
	"Name", "ClassName", "Parent", "Archivable", "Position", "Size", "CFrame", "Orientation", "Color", "BrickColor",
	"Material", "Transparency", "Anchored", "CanCollide", "CastShadow", "Shape", "MeshId", "TextureID", "Text",
	"TextColor3", "BackgroundColor3", "BackgroundTransparency", "Image", "Visible", "Enabled", "Value", "PrimaryPart",
	"WalkSpeed", "JumpPower", "Health", "MaxHealth", "SoundId", "Volume", "Looped", "Brightness", "Range",
	"AnchorPoint", "ZIndex", "Disabled", "RunContext", "LinkedSource",
}

local function properties(inst)
	local props = {}
	for _, name in ipairs(COMMON_PROPS) do
		local ok, value = pcall(function()
			return inst[name]
		end)
		if ok and value ~= nil then
			props[name] = typeof(value) == "Instance" and pathOf(value) or tostring(value)
		end
	end
	local attrs = {}
	for key, value in pairs(inst:GetAttributes()) do
		attrs[key] = tostring(value)
	end
	props.Attributes = attrs
	props.Tags = inst:GetTags()
	return props
end

local function setSource(script, source)
	local ok = pcall(function()
		ScriptEditorService:UpdateSourceAsync(script, function()
			return source
		end)
	end)
	if not ok then
		script.Source = source
	end
end

-- Exécute du Luau en mode plugin : on passe par un ModuleScript neuf (loadstring est
-- interdit aux plugins), avec print/warn redirigés vers le résultat renvoyé à l'IA.
local function runLuau(code)
	local logs = {}
	local function capture(prefix)
		return function(...)
			local pieces = table.pack(...)
			for i = 1, pieces.n do
				pieces[i] = tostring(pieces[i])
			end
			table.insert(logs, prefix .. table.concat(pieces, " ", 1, pieces.n))
		end
	end
	local module = Instance.new("ModuleScript")
	module.Name = "RoForgeRun"
	setSource(module, "return function(print, warn, plugin)\n" .. code .. "\nend")
	module.Parent = nil
	local okRequire, fn = pcall(require, module)
	module:Destroy()
	if not okRequire then
		error("Erreur de compilation : " .. tostring(fn))
	end
	local recording = ChangeHistoryService:TryBeginRecording("RoForge IA")
	local results = table.pack(pcall(fn, capture(""), capture("[warn] "), plugin))
	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end
	if not results[1] then
		return { ok = false, error = tostring(results[2]), logs = logs }
	end
	local returned = {}
	for i = 2, results.n do
		local value = results[i]
		table.insert(returned, typeof(value) == "Instance" and pathOf(value) or tostring(value))
	end
	return { ok = true, returned = returned, logs = logs }
end

-- Sauvegarde légère : copie de Workspace + services clés dans ServerStorage, avant les
-- grosses modifications de l'IA (retour arrière sans fermer Studio).
local SNAPSHOT_SERVICES = { "Workspace", "ReplicatedStorage", "ServerScriptService", "StarterGui", "StarterPlayer", "Lighting" }

local function snapshotFolder()
	local folder = ServerStorage:FindFirstChild("RoForgeSauvegardes")
	if not folder then
		folder = Instance.new("Folder")
		folder.Name = "RoForgeSauvegardes"
		folder.Parent = ServerStorage
	end
	return folder
end

local function createSnapshot(label)
	local root = Instance.new("Folder")
	root.Name = os.date("%Y-%m-%d %H-%M-%S") .. (label and (" " .. label) or "")
	for _, serviceName in ipairs(SNAPSHOT_SERVICES) do
		local service = game:GetService(serviceName)
		local copy = Instance.new("Folder")
		copy.Name = serviceName
		for _, child in ipairs(service:GetChildren()) do
			if child.Archivable and not child:IsA("Terrain") and not child:IsA("Camera") and child.ClassName ~= "Player" then
				local ok, clone = pcall(child.Clone, child)
				if ok and clone then
					clone.Parent = copy
				end
			end
		end
		copy.Parent = root
	end
	root.Parent = snapshotFolder()
	return root.Name
end

local function restoreSnapshot(name)
	local root = snapshotFolder():FindFirstChild(name)
	if not root then
		error("Sauvegarde introuvable : " .. tostring(name))
	end
	createSnapshot("avant restauration")
	local recording = ChangeHistoryService:TryBeginRecording("RoForge restauration")
	for _, copy in ipairs(root:GetChildren()) do
		local service = game:GetService(copy.Name)
		for _, child in ipairs(service:GetChildren()) do
			if child.Archivable and not child:IsA("Terrain") and not child:IsA("Camera") and child.ClassName ~= "Player" then
				pcall(child.Destroy, child)
			end
		end
		for _, child in ipairs(copy:GetChildren()) do
			child:Clone().Parent = service
		end
	end
	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end
	return true
end

---------------------------------------------------------------------------
-- Test de jeu automatique (StudioTestService) : un joueur simulé joue en Play
---------------------------------------------------------------------------
-- Script serveur inséré pendant le test : pilote le personnage, note erreurs,
-- blocages, morts, interactions, économie et performances, puis rend le rapport.
local TEST_SERVER = [==[
local StudioTestService = game:GetService("StudioTestService")
local okArgs, args = pcall(function() return StudioTestService:GetTestArgs() end)
if not okArgs or type(args) ~= "table" or not args.roforge then return end

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local PathfindingService = game:GetService("PathfindingService")
local LogService = game:GetService("LogService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local t0 = os.clock()
local duration = math.clamp(tonumber(args.duration) or 45, 10, 300)
local report = { duration = duration, errors = {}, warnings = {}, stuck = {}, deaths = {}, falls = 0,
	visited = 0, targets = 0, prompts = 0, promptNames = {}, ui = nil, perf = {}, economy = {}, notes = {} }
local seen = {}
local finished = false

-- Messages du moteur Roblox lui-même (avatar, Studio) : pas des bugs du jeu.
local ENGINE_NOISE = { "No cage data exists", "TemporaryReferenceId" }
report.engine = 0
local function addLog(kind, text, side)
	if text:find("RoForgeTest", 1, true) then return end
	for _, pattern in ipairs(ENGINE_NOISE) do
		if text:find(pattern, 1, true) then report.engine += 1 return end
	end
	local key = kind .. side .. text
	if seen[key] then seen[key].count += 1 return end
	local entry = { text = text:sub(1, 600), side = side, count = 1, t = math.floor(os.clock() - t0) }
	seen[key] = entry
	local list = kind == "error" and report.errors or report.warnings
	if #list < 60 then table.insert(list, entry) end
end
local function onMessage(msg, mt, side)
	if mt == Enum.MessageType.MessageError then addLog("error", msg, side)
	elseif mt == Enum.MessageType.MessageWarning then addLog("warn", msg, side) end
end
for _, m in ipairs(LogService:GetLogHistory()) do onMessage(m.message, m.messageType, "serveur") end
LogService.MessageOut:Connect(function(msg, mt) onMessage(msg, mt, "serveur") end)

local remote = Instance.new("RemoteEvent")
remote.Name = "RoForgeTestRemote"
remote.Parent = ReplicatedStorage
local clientFps = {}
remote.OnServerEvent:Connect(function(_, kind, a, b)
	if kind == "log" then onMessage(b, Enum.MessageType[a] or Enum.MessageType.MessageOutput, "client")
	elseif kind == "perf" then table.insert(clientFps, a) report.perf.memoryMb = b
	elseif kind == "ui" then report.ui = a
	elseif kind == "prompt" then report.prompts += 1 if #report.promptNames < 30 then table.insert(report.promptNames, a) end end
end)

local function finish(reason)
	if finished then return end
	finished = true
	if reason then table.insert(report.notes, reason) end
	report.elapsed = math.floor(os.clock() - t0)
	if #clientFps > 0 then
		local sum, minv = 0, math.huge
		for _, f in ipairs(clientFps) do sum += f minv = math.min(minv, f) end
		report.perf.fpsAvg = math.floor(sum / #clientFps) report.perf.fpsMin = math.floor(minv)
	end
	report.perf.instances = #game:GetDescendants()
	local parts = 0
	for _, d in ipairs(workspace:GetDescendants()) do if d:IsA("BasePart") then parts += 1 end end
	report.perf.parts = parts
	-- Rapport en texte JSON : Studio le renvoie de façon fiable (une table imbriquée revient parfois vide).
	StudioTestService:EndTest(game:GetService("HttpService"):JSONEncode(report))
end
task.delay(duration + 45, function() finish("Arrêt de sécurité : le test a dépassé la durée prévue.") end)

local function leaderstats(player)
	local out = {}
	local ls = player:FindFirstChild("leaderstats")
	if ls then for _, v in ipairs(ls:GetChildren()) do if v:IsA("ValueBase") then out[v.Name] = tostring(v.Value) end end end
	for k, v in pairs(player:GetAttributes()) do if type(v) == "number" then out["@" .. k] = tostring(v) end end
	return out
end

local ok, err = pcall(function()
	local player = Players:GetPlayers()[1] or Players.PlayerAdded:Wait()
	local character = player.Character or player.CharacterAdded:Wait()
	task.wait(3) -- erreurs de démarrage
	report.economy.start = leaderstats(player)

	local function hookCharacter(char)
		local hum = char:WaitForChild("Humanoid", 10)
		if hum then
			hum.Died:Connect(function()
				local root = char:FindFirstChild("HumanoidRootPart")
				table.insert(report.deaths, { t = math.floor(os.clock() - t0), pos = root and tostring(Vector3.new(math.floor(root.Position.X), math.floor(root.Position.Y), math.floor(root.Position.Z))) or "?" })
			end)
		end
	end
	hookCharacter(character)
	player.CharacterAdded:Connect(function(c) character = c hookCharacter(c) end)

	remote:FireClient(player, "ui")

	-- Cibles : interactions (ProximityPrompt), points d'apparition, points au hasard autour.
	local targets = {}
	for _, d in ipairs(workspace:GetDescendants()) do
		if d:IsA("ProximityPrompt") and d.Enabled then
			local p = d.Parent
			local part = p and (p:IsA("BasePart") and p or (p:IsA("Attachment") and p.Parent) or (p:IsA("Model") and (p.PrimaryPart or p:FindFirstChildWhichIsA("BasePart", true))))
			if part and part:IsA("BasePart") then table.insert(targets, { pos = part.Position, name = d.ObjectText ~= "" and d.ObjectText or (d.ActionText ~= "" and d.ActionText or part.Name), prompt = true }) end
		elseif d:IsA("SpawnLocation") then
			table.insert(targets, { pos = d.Position, name = d.Name })
		end
	end
	local origin = character:WaitForChild("HumanoidRootPart").Position
	local params = RaycastParams.new()
	params.FilterDescendantsInstances = { character }
	for i = 1, 12 do
		local angle = (i / 12) * math.pi * 2
		local r = 25 + (i % 4) * 25
		local from = origin + Vector3.new(math.cos(angle) * r, 80, math.sin(angle) * r)
		local hit = workspace:Raycast(from, Vector3.new(0, -300, 0), params)
		if hit then table.insert(targets, { pos = hit.Position, name = "exploration " .. i }) end
	end
	report.targets = #targets

	local stuckSeen = {}
	local function walkTo(target)
		local hum = character:FindFirstChildOfClass("Humanoid")
		local root = character:FindFirstChild("HumanoidRootPart")
		if not hum or not root or hum.Health <= 0 then return false end
		local path = PathfindingService:CreatePath({ AgentCanJump = true, AgentRadius = 2, AgentHeight = 5 })
		local okPath = pcall(function() path:ComputeAsync(root.Position, target.pos) end)
		local waypoints = (okPath and path.Status == Enum.PathStatus.Success) and path:GetWaypoints() or { { Position = target.pos, Action = Enum.PathWaypointAction.Walk } }
		for _, wp in ipairs(waypoints) do
			if finished or os.clock() - t0 > duration then return false end
			if wp.Action == Enum.PathWaypointAction.Jump then hum.Jump = true end
			local before = (root.Position - wp.Position).Magnitude
			hum:MoveTo(wp.Position)
			local reached = false
			local conn = hum.MoveToFinished:Connect(function(r) reached = r end)
			local start = os.clock()
			while not reached and os.clock() - start < 4 and hum.Health > 0 do
				task.wait(0.1)
				if root.Position.Y < workspace.FallenPartsDestroyHeight + 30 then report.falls += 1 break end
			end
			conn:Disconnect()
			if hum.Health <= 0 then return false end
			if not reached and before - (root.Position - wp.Position).Magnitude < 1.5 then
				local key = math.floor(root.Position.X / 10) .. "," .. math.floor(root.Position.Z / 10)
				if not stuckSeen[key] and #report.stuck < 20 then
					stuckSeen[key] = true
					table.insert(report.stuck, { t = math.floor(os.clock() - t0), cible = target.name, pos = tostring(Vector3.new(math.floor(root.Position.X), math.floor(root.Position.Y), math.floor(root.Position.Z))) })
				end
				hum.Jump = true
				return false
			end
		end
		return (root.Position - target.pos).Magnitude < 12
	end

	local i = 0
	while not finished and os.clock() - t0 < duration and #targets > 0 do
		i += 1
		local target = targets[(i - 1) % #targets + 1]
		if not character.Parent then character = player.CharacterAdded:Wait() task.wait(1) end
		if walkTo(target) then
			report.visited += 1
			if target.prompt then remote:FireClient(player, "prompts") task.wait(2) end
		end
		task.wait(0.3)
	end
	if #targets == 0 then table.insert(report.notes, "Aucune cible trouvée : le joueur est resté au point d'apparition.") task.wait(math.min(duration, 15)) end

	remote:FireClient(player, "ui")
	task.wait(2)
	report.economy["end"] = leaderstats(player)
end)
if not ok then table.insert(report.notes, "Erreur du joueur simulé : " .. tostring(err)) end
finish()
]==]

-- LocalScript inséré pendant le test : erreurs client, FPS, mémoire, interactions, audit de l'interface.
local TEST_CLIENT = [==[
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local remote = ReplicatedStorage:WaitForChild("RoForgeTestRemote", 20)
if not remote then return end
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local LogService = game:GetService("LogService")
local Stats = game:GetService("Stats")
local player = Players.LocalPlayer

pcall(function() UserSettings():GetService("UserGameSettings").MasterVolume = 0 end) -- tests en muet

for _, m in ipairs(LogService:GetLogHistory()) do
	if m.messageType == Enum.MessageType.MessageError or m.messageType == Enum.MessageType.MessageWarning then remote:FireServer("log", m.messageType.Name, m.message) end
end
LogService.MessageOut:Connect(function(msg, mt)
	if mt == Enum.MessageType.MessageError or mt == Enum.MessageType.MessageWarning then remote:FireServer("log", mt.Name, msg) end
end)

task.spawn(function()
	while true do
		local frames, start = 0, os.clock()
		local conn = RunService.RenderStepped:Connect(function() frames += 1 end)
		task.wait(5)
		conn:Disconnect()
		remote:FireServer("perf", math.floor(frames / (os.clock() - start)), math.floor(Stats:GetTotalMemoryUsageMb()))
	end
end)

local function visible(gui)
	local node = gui
	while node and node:IsA("GuiObject") do
		if not node.Visible then return false end
		node = node.Parent
	end
	return true
end

local function auditUi()
	local cam = workspace.CurrentCamera
	local vp = cam and cam.ViewportSize or Vector2.new(1920, 1080)
	local out = { viewport = tostring(vp), screens = {}, offscreen = {}, overflow = {}, tiny = {}, buttons = 0 }
	for _, sg in ipairs(player:WaitForChild("PlayerGui"):GetChildren()) do
		if sg:IsA("ScreenGui") and sg.Enabled and sg.Name ~= "Freecam" then
			table.insert(out.screens, sg.Name)
			for _, g in ipairs(sg:GetDescendants()) do
				if g:IsA("GuiObject") and visible(g) and g.AbsoluteSize.X > 0 then
					local p, s = g.AbsolutePosition, g.AbsoluteSize
					local name = g:GetFullName():gsub("^Players%.[^%.]+%.PlayerGui%.", "")
					if (p.X + s.X < 0 or p.Y + s.Y < -40 or p.X > vp.X or p.Y > vp.Y) and #out.offscreen < 15 then table.insert(out.offscreen, name) end
					if (g:IsA("TextLabel") or g:IsA("TextButton")) and not g.TextScaled and not g.TextFits and g.Text ~= "" and #out.overflow < 15 then table.insert(out.overflow, name) end
					if g:IsA("GuiButton") then
						out.buttons += 1
						if (s.X < 32 or s.Y < 32) and #out.tiny < 15 then table.insert(out.tiny, name .. " (" .. math.floor(s.X) .. "×" .. math.floor(s.Y) .. ")") end
					end
				end
			end
		end
	end
	return out
end

remote.OnClientEvent:Connect(function(kind)
	if kind == "ui" then
		local ok, data = pcall(auditUi)
		remote:FireServer("ui", ok and data or { error = tostring(data) })
	elseif kind == "prompts" then
		local char = player.Character
		local root = char and char:FindFirstChild("HumanoidRootPart")
		if not root then return end
		for _, prompt in ipairs(workspace:GetDescendants()) do
			if prompt:IsA("ProximityPrompt") and prompt.Enabled then
				local part = prompt.Parent
				part = part and (part:IsA("Attachment") and part.Parent or part)
				local pos = part and (part:IsA("BasePart") and part.Position or (part:IsA("Model") and part:GetPivot().Position))
				if pos and (pos - root.Position).Magnitude <= prompt.MaxActivationDistance + 2 then
					pcall(function()
						prompt:InputHoldBegin()
						task.wait(prompt.HoldDuration + 0.15)
						prompt:InputHoldEnd()
					end)
					remote:FireServer("prompt", prompt.ActionText ~= "" and prompt.ActionText or prompt.Parent.Name)
				end
			end
		end
	end
end)
]==]

local function runPlaytest(args)
	local StudioTestService = game:GetService("StudioTestService")
	local StarterPlayer = game:GetService("StarterPlayer")
	if RunService:IsRunning() then
		error("Un test est déjà en cours dans Studio : arrête le Play d'abord.")
	end
	local server = Instance.new("Script")
	server.Name = "RoForgeTestRunner"
	setSource(server, TEST_SERVER)
	server.Parent = game:GetService("ServerScriptService")
	local client = Instance.new("LocalScript")
	client.Name = "RoForgeTestClient"
	setSource(client, TEST_CLIENT)
	client.Parent = StarterPlayer:FindFirstChildOfClass("StarterPlayerScripts")
	local duration = args.duration or 45
	local ok, result, elapsed
	local interrupted = 0
	-- Un autre outil branché sur Studio (ex. plugin MCPPlugin de robloxstudio-mcp) peut arrêter
	-- n'importe quel Play : si le Play s'arrête trop tôt sans rapport, on réessaie (3 essais).
	for attempt = 1, 3 do
		local started = os.clock()
		ok, result = pcall(function()
			return StudioTestService:ExecutePlayModeAsync({ roforge = true, duration = duration })
		end)
		elapsed = math.floor(os.clock() - started)
		if type(result) == "string" then
			local okJson, decoded = pcall(HttpService.JSONDecode, HttpService, result)
			result = okJson and decoded or nil
		end
		if not ok or type(result) == "table" or elapsed >= duration then
			break
		end
		interrupted += 1
		task.wait(2)
	end
	server:Destroy()
	client:Destroy()
	if not ok then
		error("Test de jeu impossible : " .. tostring(result))
	end
	if type(result) ~= "table" then
		if elapsed < duration then
			error(("Le Play a été arrêté au bout de %d s par un autre outil branché sur Studio (souvent le plugin MCPPlugin de robloxstudio-mcp, lancé par une autre app comme WebnR). Ferme cette app ou désactive ce plugin dans Studio, puis relance le test."):format(elapsed))
		end
		error("Studio n'a pas renvoyé de rapport (le Play a-t-il été arrêté à la main ?). Relance le test.")
	end
	if interrupted > 0 then
		result.notes = result.notes or {}
		table.insert(result.notes, ("%d essai(s) coupé(s) par un autre outil branché sur Studio (ex. WebnR / robloxstudio-mcp) : relancé automatiquement."):format(interrupted))
	end
	return result
end

local handlers = {}

handlers.playtest = function(args)
	ctx.status("test de jeu")
	return runPlaytest(args)
end

handlers.ping = function()
	return { version = ctx.version, place = game.Name, placeId = game.PlaceId }
end

handlers.run_luau = function(args)
	return runLuau(args.code)
end

handlers.get_tree = function(args)
	local out = {}
	describe(resolve(args.path), args.depth or 2, args.maxChildren or 60, out, 0)
	return table.concat(out, "\n")
end

handlers.get_properties = function(args)
	return properties(resolve(args.path))
end

handlers.read_script = function(args)
	local inst = resolve(args.path)
	if not inst:IsA("LuaSourceContainer") then
		error(args.path .. " n'est pas un script")
	end
	return { className = inst.ClassName, source = inst.Source }
end

handlers.write_script = function(args)
	local parentPath, name = args.path:match("^(.*)[%./]([^%./]+)$")
	if not parentPath then
		error("Chemin invalide, exemple : ServerScriptService.Combat")
	end
	local parent = resolve(parentPath)
	local inst = parent:FindFirstChild(name)
	local recording = ChangeHistoryService:TryBeginRecording("RoForge script")
	if inst and args.className and inst.ClassName ~= args.className then
		inst:Destroy()
		inst = nil
	end
	local created = false
	if not inst then
		inst = Instance.new(args.className or "Script")
		inst.Name = name
		inst.Parent = parent
		created = true
	end
	setSource(inst, args.source)
	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end
	return { path = pathOf(inst), created = created, lines = #string.split(args.source, "\n") }
end

handlers.delete = function(args)
	local inst = resolve(args.path)
	if inst == game or inst.Parent == game then
		error("Refusé : impossible de supprimer un service")
	end
	local recording = ChangeHistoryService:TryBeginRecording("RoForge suppression")
	inst:Destroy()
	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end
	return true
end

handlers.get_selection = function()
	local list = {}
	for _, inst in ipairs(Selection:Get()) do
		table.insert(list, { path = pathOf(inst), className = inst.ClassName })
	end
	return list
end

handlers.set_selection = function(args)
	local list = {}
	for _, p in ipairs(args.paths or {}) do
		table.insert(list, resolve(p))
	end
	Selection:Set(list)
	return #list
end

handlers.snapshot = function(args)
	return createSnapshot(args.label)
end

handlers.list_snapshots = function()
	local names = {}
	for _, child in ipairs(snapshotFolder():GetChildren()) do
		table.insert(names, child.Name)
	end
	table.sort(names)
	return names
end

handlers.restore_snapshot = function(args)
	return restoreSnapshot(args.name)
end

-- @@KIT3D@@ (remplacé par plugin/kit3d.lua quand le pont sert le cœur)

return handlers
end
