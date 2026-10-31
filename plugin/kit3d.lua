-- RoForge — outils 3D du plugin (injectés dans core.lua par le pont, à la place du repère KIT3D).
-- bounds : boîte englobante d'un modèle (pour les vues / captures).
-- audit3d : contrôle qualité 3D en lecture seule (pièces flottantes, z-fighting, néon, pivot…).
-- kit_piece : pièces de décor soignées (style simulator ou réaliste), jamais de néon.
-- ambiance : préréglages d'éclairage. kit_vfx : effets de particules propres.

local Lighting = game:GetService("Lighting")

local function boundsOf(inst)
	if inst:IsA("BasePart") then
		return inst.CFrame, inst.Size
	elseif inst:IsA("Model") then
		return inst:GetBoundingBox()
	end
	local parts = {}
	for _, d in ipairs(inst:GetDescendants()) do
		if d:IsA("BasePart") then table.insert(parts, d) end
	end
	if #parts == 0 then error("Aucune pièce dans " .. inst:GetFullName()) end
	local minV, maxV = Vector3.new(math.huge, math.huge, math.huge), Vector3.new(-math.huge, -math.huge, -math.huge)
	for _, p in ipairs(parts) do
		local half = p.Size / 2
		for _, sx in ipairs({ -1, 1 }) do
			for _, sy in ipairs({ -1, 1 }) do
				for _, sz in ipairs({ -1, 1 }) do
					local w = p.CFrame:PointToWorldSpace(Vector3.new(half.X * sx, half.Y * sy, half.Z * sz))
					minV = minV:Min(w)
					maxV = maxV:Max(w)
				end
			end
		end
	end
	return CFrame.new((minV + maxV) / 2), maxV - minV
end

handlers.bounds = function(args)
	local inst = resolve(args.path)
	local cf, size = boundsOf(inst)
	local look = inst:IsA("Model") and inst:GetPivot().LookVector or cf.LookVector
	return { centre = { cf.Position.X, cf.Position.Y, cf.Position.Z }, taille = { size.X, size.Y, size.Z }, avant = { look.X, look.Y, look.Z } }
end

-- Isolement pour la planche de vues : le modèle est déplacé seul sur un sol neutre loin de la
-- scène (rien ne gêne les angles), puis remis exactement à sa place par unisolate.
local STUDIO_SPOT = Vector3.new(0, 1500, 0)

-- Le sol neutre se cache pour la vue de dessous.
handlers.studio_floor = function(args)
	local floor = workspace:FindFirstChild("RoForgeSolStudio")
	if floor then floor.Transparency = args.visible == false and 1 or 0 end
	return floor ~= nil
end

handlers.isolate = function(args)
	local inst = resolve(args.path)
	if not (inst:IsA("Model") or inst:IsA("BasePart")) then error("Modèle ou pièce attendu pour la planche") end
	if inst:GetAttribute("RoForgePivotAvant") then error("Déjà isolé : appelle unisolate d'abord") end
	local pivot = inst:GetPivot()
	local cf, size = boundsOf(inst)
	inst:SetAttribute("RoForgePivotAvant", pivot)
	local bottomCentre = cf.Position - Vector3.new(0, size.Y / 2, 0)
	inst:PivotTo(CFrame.new(STUDIO_SPOT + (pivot.Position - bottomCentre)) * pivot.Rotation)
	local floor = Instance.new("Part")
	floor.Name = "RoForgeSolStudio"
	floor.Anchored = true
	floor.Locked = true
	floor.Size = Vector3.new(math.max(size.X, size.Z) * 8 + 40, 1, math.max(size.X, size.Z) * 8 + 40)
	floor.CFrame = CFrame.new(STUDIO_SPOT - Vector3.new(0, 0.5, 0))
	floor.Color = Color3.fromRGB(150, 158, 150)
	floor.Material = Enum.Material.SmoothPlastic
	floor.Parent = workspace
	return true
end

handlers.unisolate = function(args)
	local inst = resolve(args.path)
	local pivot = inst:GetAttribute("RoForgePivotAvant")
	if typeof(pivot) == "CFrame" then inst:PivotTo(pivot) end
	inst:SetAttribute("RoForgePivotAvant", nil)
	local floor = workspace:FindFirstChild("RoForgeSolStudio")
	if floor then floor:Destroy() end
	return true
end

---------------------------------------------------------------------------
-- Contrôle qualité 3D (lecture seule)
---------------------------------------------------------------------------
local function round(v, d)
	local m = 10 ^ (d or 2)
	return math.floor(v * m + 0.5) / m
end

local function isAxisAligned(a, b)
	local r = a.CFrame:ToObjectSpace(b.CFrame)
	for _, v in ipairs({ r.RightVector, r.UpVector, r.LookVector }) do
		local ax = math.max(math.abs(v.X), math.abs(v.Y), math.abs(v.Z))
		if ax < 0.999 then return false end
	end
	return true
end

-- Faces coplanaires superposées entre deux blocs alignés (z-fighting).
local function coplanarOverlap(a, b)
	-- Seulement les blocs « Part » (les WedgePart / MeshPart n'ont pas de Shape Block).
	if not (a.ClassName == "Part" and b.ClassName == "Part") then return false end
	if a.Shape ~= Enum.PartType.Block or b.Shape ~= Enum.PartType.Block then return false end
	if a.Transparency >= 1 or b.Transparency >= 1 then return false end
	if not isAxisAligned(a, b) then return false end
	local rel = a.CFrame:ToObjectSpace(b.CFrame)
	local bHalfLocal = Vector3.new(0, 0, 0)
	for i, axis in ipairs({ rel.RightVector, rel.UpVector, rel.LookVector }) do
		local h = ({ b.Size.X, b.Size.Y, b.Size.Z })[i] / 2
		bHalfLocal += Vector3.new(math.abs(axis.X) * h, math.abs(axis.Y) * h, math.abs(axis.Z) * h)
	end
	local c, ha = rel.Position, a.Size / 2
	local bMin, bMax = c - bHalfLocal, c + bHalfLocal
	local aMin, aMax = -ha, ha
	local eps = 0.006
	for _, ax in ipairs({ "X", "Y", "Z" }) do
		for _, faceA in ipairs({ aMin[ax], aMax[ax] }) do
			for _, faceB in ipairs({ bMin[ax], bMax[ax] }) do
				if math.abs(faceA - faceB) < eps then
					-- même plan : les deux autres axes doivent se recouvrir, et les volumes être du même côté
					local others = ax == "X" and { "Y", "Z" } or ax == "Y" and { "X", "Z" } or { "X", "Y" }
					local overlap = true
					for _, o in ipairs(others) do
						if math.min(aMax[o], bMax[o]) - math.max(aMin[o], bMin[o]) <= eps then overlap = false end
					end
					local sameSide = (faceA == aMin[ax]) == (faceB == bMin[ax])
					if overlap and sameSide then
						-- Plan partagé en coordonnées monde (pour ignorer les faces posées au sol, invisibles).
						local localPoint = Vector3.new(ax == "X" and faceA or 0, ax == "Y" and faceA or 0, ax == "Z" and faceA or 0)
						local axisWorld = a.CFrame:VectorToWorldSpace(Vector3.new(ax == "X" and 1 or 0, ax == "Y" and 1 or 0, ax == "Z" and 1 or 0))
						local outward = faceA == aMin[ax] and -axisWorld or axisWorld
						-- faceDown : les deux faces regardent vers le bas (posées sur un support, invisibles).
						return true, a.CFrame:PointToWorldSpace(localPoint).Y, outward.Y < -0.99
					end
				end
			end
		end
	end
	return false
end

handlers.audit3d = function(args)
	local target = resolve(args.path)
	local parts = {}
	if target:IsA("BasePart") then table.insert(parts, target) end
	for _, d in ipairs(target:GetDescendants()) do
		if d:IsA("BasePart") and #parts < 4000 then table.insert(parts, d) end
	end
	local constats = {}
	local counts = { erreur = 0, avertissement = 0, info = 0 }
	local function add(code, gravite, message, instances, details)
		counts[gravite] += 1
		local list = {}
		for i, inst in ipairs(instances or {}) do
			if i > 25 then table.insert(list, ("… +%d"):format(#instances - 25)) break end
			table.insert(list, typeof(inst) == "Instance" and inst:GetFullName() or tostring(inst))
		end
		table.insert(constats, { code = code, gravite = gravite, message = message, instances = list, details = details })
	end

	local inSet = {}
	for _, p in ipairs(parts) do inSet[p] = true end

	-- Néon et effets lumineux (interdits : rendu pro, jamais néon)
	local neon, lights, highlights = {}, {}, {}
	for _, p in ipairs(parts) do
		if p.Material == Enum.Material.Neon then table.insert(neon, p) end
	end
	for _, d in ipairs(target:GetDescendants()) do
		if d:IsA("Light") then table.insert(lights, d) elseif d:IsA("Highlight") then table.insert(highlights, d) end
	end
	if #neon > 0 then add("NEON", "erreur", ("%d pièce(s) en matériau Neon : interdit (rendu pro). Utilise SmoothPlastic/Glass + une vraie lumière."):format(#neon), neon) end
	if #highlights > 0 then add("GLOW", "avertissement", ("%d Highlight : effet lumineux à éviter sauf sélection/gameplay."):format(#highlights), highlights) end
	if #lights > 10 then add("LUM", "avertissement", ("%d lumières dans ce modèle : coûteux, garde les plus utiles."):format(#lights), lights) end

	-- Pièces libres non ancrées et sans soudure
	local loose = {}
	for _, p in ipairs(parts) do
		if not p.Anchored and #p:GetJoints() == 0 then table.insert(loose, p) end
	end
	if #loose > 0 then add("S1", "erreur", ("%d pièce(s) ni ancrées ni soudées : elles vont tomber."):format(#loose), loose) end

	-- Pièces minuscules
	local tiny = {}
	for _, p in ipairs(parts) do
		if math.min(p.Size.X, p.Size.Y, p.Size.Z) < 0.05 and p.Transparency < 1 then table.insert(tiny, p) end
	end
	if #tiny > 0 then add("A6", "avertissement", ("%d pièce(s) plus fines que 0,05 stud : scintillement possible."):format(#tiny), tiny) end

	-- Z-fighting et interpénétrations (dans le modèle)
	local overlapParams = OverlapParams.new()
	overlapParams.FilterType = Enum.RaycastFilterType.Include
	overlapParams.FilterDescendantsInstances = { target }
	local zfight, inside = {}, {}
	local seenPair = {}
	for i, p in ipairs(parts) do
		if i > 1500 then break end
		for _, q in ipairs(workspace:GetPartBoundsInBox(p.CFrame, p.Size + Vector3.new(0.02, 0.02, 0.02), overlapParams)) do
			if q ~= p and inSet[q] then
				local key = p:GetDebugId() < q:GetDebugId() and (p:GetDebugId() .. q:GetDebugId()) or (q:GetDebugId() .. p:GetDebugId())
				if not seenPair[key] then
					seenPair[key] = true
					local same, _, faceDown = coplanarOverlap(p, q)
					if same and faceDown then
						-- faces du dessous posées sur un support : invisibles, pas de scintillement
					elseif same and p.Color ~= q.Color then
						table.insert(zfight, p.Name .. " ↔ " .. q.Name .. " (" .. p:GetFullName() .. ")")
					elseif not p:GetAttribute("AllowOverlap") and not q:GetAttribute("AllowOverlap") then
						local small = p.Size.X * p.Size.Y * p.Size.Z < q.Size.X * q.Size.Y * q.Size.Z and p or q
						local big = small == p and q or p
						local rel = big.CFrame:PointToObjectSpace(small.Position)
						local half = big.Size / 2
						if math.abs(rel.X) < half.X * 0.6 and math.abs(rel.Y) < half.Y * 0.6 and math.abs(rel.Z) < half.Z * 0.6 and big.Transparency < 0.5 and small.Transparency < 1 then
							table.insert(inside, small.Name .. " est caché dans " .. big.Name)
						end
					end
				end
			end
		end
	end
	if #zfight > 0 then add("A1", "erreur", ("%d paire(s) de faces superposées de couleurs différentes (z-fighting / scintillement)."):format(#zfight), zfight) end
	if #inside > 0 then add("B1", "info", ("%d pièce(s) enfouie(s) dans une autre (inutiles ou mal placées ?)."):format(#inside), inside) end

	-- Pièces flottantes (aucun contact avec le modèle ni le décor)
	local worldParams = OverlapParams.new()
	worldParams.FilterType = Enum.RaycastFilterType.Exclude
	worldParams.FilterDescendantsInstances = {}
	local floating = {}
	for i, p in ipairs(parts) do
		if i > 1500 then break end
		if p.Transparency < 1 and #parts > 1 then
			local touching = false
			for _, q in ipairs(workspace:GetPartBoundsInBox(p.CFrame, p.Size + Vector3.new(0.12, 0.12, 0.12), worldParams)) do
				if q ~= p then
					touching = true
					break
				end
			end
			if not touching then table.insert(floating, p) end
		end
	end
	if #floating > 0 then add("B2", "erreur", ("%d pièce(s) qui flottent sans rien toucher."):format(#floating), floating) end

	-- Le modèle entier : posé au sol ?
	local cf, size = boundsOf(target)
	local bottom = cf.Position - Vector3.new(0, size.Y / 2, 0)
	local rp = RaycastParams.new()
	rp.FilterType = Enum.RaycastFilterType.Exclude
	rp.FilterDescendantsInstances = { target }
	-- Rayon depuis le haut du modèle (en partant du bas on peut démarrer DANS le sol et ne rien toucher).
	local hit = workspace:Raycast(bottom + Vector3.new(0, size.Y + 1, 0), Vector3.new(0, -(size.Y + 500), 0), rp)
	if hit and (bottom.Y - hit.Position.Y) > 0.25 then
		add("B2M", "avertissement", ("Le modèle flotte à %.2f stud(s) au-dessus de « %s »."):format(bottom.Y - hit.Position.Y, hit.Instance.Name), { target }, { ecart = round(bottom.Y - hit.Position.Y) })
	elseif hit and (hit.Position.Y - bottom.Y) > 1 then
		add("B2M", "info", ("Une partie du modèle s'enfonce de %.2f stud(s) dans « %s » (normal pour un rocher, à vérifier sinon)."):format(hit.Position.Y - bottom.Y, hit.Instance.Name), { target })
	elseif not hit then
		add("B2M", "info", "Rien sous le modèle (pas de sol détecté).", { target })
	end

	-- Organisation
	if target:IsA("Model") then
		if not target.PrimaryPart then add("C1", "avertissement", "Model sans PrimaryPart : déplacement et pivot moins fiables.", { target }) end
		local pivot = target:GetPivot().Position
		local offset = Vector3.new(pivot.X - cf.Position.X, pivot.Y - bottom.Y, pivot.Z - cf.Position.Z)
		if offset.Magnitude > math.max(size.X, size.Z) * 0.35 then
			add("C1P", "info", "Le pivot est loin du centre de la base.", { target }, { ecart = round(offset.Magnitude) })
		end
	end

	-- Palette et matériaux
	local colors, materials = {}, {}
	local nColors, nMaterials = 0, 0
	for _, p in ipairs(parts) do
		if p.Transparency < 1 then
			-- Teintes regroupées (les variations volontaires de ±8 % comptent comme une seule couleur).
			local c = p.Color
			local q = function(v) return math.floor(v * 7 + 0.5) / 7 end
			local key = Color3.new(q(c.R), q(c.G), q(c.B)):ToHex()
			if not colors[key] then colors[key] = 0 nColors += 1 end
			colors[key] += 1
			if not materials[p.Material.Name] then materials[p.Material.Name] = 0 nMaterials += 1 end
			materials[p.Material.Name] += 1
		end
	end
	if nColors > 14 then add("PAL", "avertissement", ("%d couleurs différentes : palette dispersée, vise 4 à 8 teintes."):format(nColors), {}) end
	if nColors == 1 and #parts > 6 then add("PAL", "avertissement", "Une seule couleur : modèle monotone, ajoute des variations.", {}) end
	if #parts > 1500 then add("PERF", "avertissement", ("%d pièces : lourd, regroupe ou simplifie."):format(#parts), {}) end
	local textured = false
	for _, p in ipairs(parts) do if p:IsA("MeshPart") then textured = true break end end
	if #parts > 0 and #parts < 6 and args.creature ~= true and not textured then add("DET", "info", ("Seulement %d pièce(s) : sans doute pas assez de détails pour un rendu pro."):format(#parts), {}) end

	local topColors = {}
	for hex, n in pairs(colors) do table.insert(topColors, { hex = "#" .. hex, n = n }) end
	table.sort(topColors, function(a, b) return a.n > b.n end)
	return {
		cible = target:GetFullName(),
		resume = counts,
		constats = constats,
		stats = { pieces = #parts, couleurs = nColors, materiaux = materials, palette = { table.unpack(topColors, 1, math.min(8, #topColors)) }, taille = { round(size.X), round(size.Y), round(size.Z) } },
		limites = "Maillages et unions : seule la boîte englobante est lue. Ni UV, ni rig, ni style : toujours vérifier la planche de vues.",
	}
end

---------------------------------------------------------------------------
-- Kit de pièces de décor (rendu pro, jamais néon)
---------------------------------------------------------------------------
local STYLES = {
	simulator = {
		material = Enum.Material.SmoothPlastic, wood = Enum.Material.SmoothPlastic, metal = Enum.Material.SmoothPlastic, stone = Enum.Material.SmoothPlastic, cloth = Enum.Material.SmoothPlastic,
		bois = Color3.fromRGB(196, 132, 82), boisFonce = Color3.fromRGB(150, 96, 58), pierre = Color3.fromRGB(150, 156, 168), metalC = Color3.fromRGB(90, 96, 110),
		feuille = Color3.fromRGB(96, 196, 86), feuilleFonce = Color3.fromRGB(64, 160, 70), accent = Color3.fromRGB(240, 84, 84), accent2 = Color3.fromRGB(255, 244, 228), round = true,
	},
	realiste = {
		material = Enum.Material.SmoothPlastic, wood = Enum.Material.Wood, metal = Enum.Material.Metal, stone = Enum.Material.Slate, cloth = Enum.Material.Fabric,
		bois = Color3.fromRGB(124, 92, 64), boisFonce = Color3.fromRGB(86, 62, 44), pierre = Color3.fromRGB(112, 110, 104), metalC = Color3.fromRGB(70, 72, 76),
		feuille = Color3.fromRGB(78, 112, 58), feuilleFonce = Color3.fromRGB(56, 86, 44), accent = Color3.fromRGB(150, 52, 44), accent2 = Color3.fromRGB(222, 212, 192), round = false,
	},
}

local function color3(v, fallback)
	if typeof(v) == "Color3" then return v end
	if type(v) == "string" and v:match("^#?%x%x%x%x%x%x$") then return Color3.fromHex(v) end
	return fallback
end

local function shade(c, k)
	return Color3.new(math.clamp(c.R * k, 0, 1), math.clamp(c.G * k, 0, 1), math.clamp(c.B * k, 0, 1))
end

local function newPart(model, name, props)
	local p = Instance.new(props.shape == "Wedge" and "WedgePart" or props.shape == "Corner" and "CornerWedgePart" or "Part")
	if p:IsA("Part") and props.shape and props.shape ~= "Block" then p.Shape = Enum.PartType[props.shape] end
	p.Name = name
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Size = props.size
	p.CFrame = props.cf
	p.Color = props.color
	p.Material = props.material or Enum.Material.SmoothPlastic
	p.CastShadow = props.shadow ~= false
	p.CanCollide = props.collide ~= false
	if props.transparency then p.Transparency = props.transparency end
	p.Parent = model
	return p
end

-- Bloc « biseauté » : un noyau + 4 arêtes verticales arrondies (style simulator) ou chanfreinées.
local function beveledBlock(model, name, size, cf, color, material, st, bevel)
	bevel = math.min(bevel or 0.18, size.X / 3, size.Z / 3)
	if not st.round or bevel < 0.05 then
		return newPart(model, name, { size = size, cf = cf, color = color, material = material })
	end
	local core = newPart(model, name, { size = Vector3.new(size.X - bevel * 2, size.Y, size.Z), cf = cf, color = color, material = material })
	newPart(model, name .. "_c", { size = Vector3.new(size.X, size.Y, size.Z - bevel * 2), cf = cf, color = color, material = material })
	for _, sx in ipairs({ -1, 1 }) do
		for _, sz in ipairs({ -1, 1 }) do
			newPart(model, name .. "_arrondi", {
				shape = "Cylinder", size = Vector3.new(size.Y, bevel * 2, bevel * 2), color = color, material = material,
				cf = cf * CFrame.new(sx * (size.X / 2 - bevel), 0, sz * (size.Z / 2 - bevel)) * CFrame.Angles(0, 0, math.rad(90)),
			})
		end
	end
	return core
end

local PIECES = {}

PIECES.caisse = function(m, st, o)
	local s = o.taille or 3
	local base = beveledBlock(m, "Caisse", Vector3.new(s, s, s), CFrame.new(0, s / 2, 0), st.bois, st.wood, st, s * 0.06)
	local frame = shade(st.bois, 0.78)
	for _, y in ipairs({ s * 0.08, s * 0.92 }) do
		for _, side in ipairs({ { s / 2, 0 }, { -s / 2, 0 }, { 0, s / 2 }, { 0, -s / 2 } }) do
			local alongX = side[1] == 0
			newPart(m, "Cadre", { size = Vector3.new(alongX and s * 1.02 or s * 0.12, s * 0.14, alongX and s * 0.12 or s * 1.02), cf = CFrame.new(side[1] * 1.0, y, side[2] * 1.0), color = frame, material = st.wood })
		end
	end
	for _, dz in ipairs({ -1, 1 }) do
		newPart(m, "Diagonale", { size = Vector3.new(s * 0.12, s * 1.15, s * 0.06), cf = CFrame.new(0, s / 2, dz * (s / 2 + 0.02)) * CFrame.Angles(0, 0, math.rad(45)), color = frame, material = st.wood })
	end
	return base
end

PIECES.tonneau = function(m, st, o)
	local h, r = o.hauteur or 4, o.rayon or 1.4
	local base = newPart(m, "Tonneau", { shape = "Cylinder", size = Vector3.new(h, r * 2, r * 2), cf = CFrame.new(0, h / 2, 0) * CFrame.Angles(0, 0, math.rad(90)), color = st.bois, material = st.wood })
	newPart(m, "Ventre", { shape = "Cylinder", size = Vector3.new(h * 0.6, r * 2.12, r * 2.12), cf = CFrame.new(0, h / 2, 0) * CFrame.Angles(0, 0, math.rad(90)), color = st.bois, material = st.wood })
	for _, y in ipairs({ h * 0.12, h * 0.5, h * 0.88 }) do
		newPart(m, "Cerclage", { shape = "Cylinder", size = Vector3.new(h * 0.07, r * 2.2, r * 2.2), cf = CFrame.new(0, y, 0) * CFrame.Angles(0, 0, math.rad(90)), color = st.metalC, material = st.metal })
	end
	return base
end

PIECES.lanterne = function(m, st, o)
	local s = o.taille or 1.6
	local base = beveledBlock(m, "Socle", Vector3.new(s, s * 0.18, s), CFrame.new(0, s * 0.09, 0), st.metalC, st.metal, st, s * 0.08)
	local glass = newPart(m, "Verre", { size = Vector3.new(s * 0.8, s * 1.1, s * 0.8), cf = CFrame.new(0, s * 0.18 + s * 0.55, 0), color = Color3.fromRGB(255, 236, 196), material = Enum.Material.Glass, transparency = 0.35 })
	for _, sx in ipairs({ -1, 1 }) do
		for _, sz in ipairs({ -1, 1 }) do
			newPart(m, "Montant", { size = Vector3.new(s * 0.1, s * 1.15, s * 0.1), cf = CFrame.new(sx * s * 0.42, s * 0.18 + s * 0.55, sz * s * 0.42), color = st.metalC, material = st.metal })
		end
	end
	newPart(m, "Toit", { size = Vector3.new(s * 1.1, s * 0.2, s * 1.1), cf = CFrame.new(0, s * 1.38, 0), color = st.metalC, material = st.metal })
	newPart(m, "Pointe", { shape = "Ball", size = Vector3.new(s * 0.3, s * 0.3, s * 0.3), cf = CFrame.new(0, s * 1.55, 0), color = st.metalC, material = st.metal })
	local light = Instance.new("PointLight")
	light.Color = Color3.fromRGB(255, 214, 150)
	light.Range = 14
	light.Brightness = 1.4
	light.Shadows = true
	light.Parent = glass
	return base
end

PIECES.lampadaire = function(m, st, o)
	local h = o.hauteur or 11
	local base = beveledBlock(m, "Pied", Vector3.new(1.6, 0.6, 1.6), CFrame.new(0, 0.3, 0), st.metalC, st.metal, st, 0.2)
	newPart(m, "Mat", { shape = "Cylinder", size = Vector3.new(h, 0.45, 0.45), cf = CFrame.new(0, h / 2, 0) * CFrame.Angles(0, 0, math.rad(90)), color = st.metalC, material = st.metal })
	newPart(m, "Bras", { size = Vector3.new(0.3, 0.3, 2.4), cf = CFrame.new(0, h - 0.3, 1), color = st.metalC, material = st.metal })
	local lamp = Instance.new("Model")
	lamp.Name = "Lanterne"
	lamp.Parent = m
	PIECES.lanterne(lamp, st, { taille = 1.3 })
	lamp:PivotTo(CFrame.new(0, h - 1.95, 2.1))
	return base
end

PIECES.arbre = function(m, st, o)
	local h = o.hauteur or 12
	local trunk = st.boisFonce
	local base = newPart(m, "Tronc", { shape = "Cylinder", size = Vector3.new(h * 0.55, h * 0.13, h * 0.13), cf = CFrame.new(0, h * 0.275, 0) * CFrame.Angles(0, 0, math.rad(90)), color = trunk, material = st.wood })
	newPart(m, "Racine", { shape = "Cylinder", size = Vector3.new(h * 0.08, h * 0.2, h * 0.2), cf = CFrame.new(0, h * 0.04, 0) * CFrame.Angles(0, 0, math.rad(90)), color = shade(trunk, 0.9), material = st.wood })
	local rng = Random.new(o.graine or 7)
	local clusters = { { 0, 0.72, 0, 0.5 }, { 0.22, 0.62, 0.12, 0.36 }, { -0.2, 0.64, -0.1, 0.38 }, { 0.05, 0.86, -0.12, 0.34 }, { -0.08, 0.6, 0.24, 0.32 } }
	for i, c in ipairs(clusters) do
		local d = h * c[4] * rng:NextNumber(0.9, 1.1)
		local col = i % 2 == 0 and st.feuilleFonce or st.feuille
		newPart(m, "Feuillage", { shape = st.round and "Ball" or "Block", size = Vector3.new(d, d * (st.round and 1 or 0.8), d), cf = CFrame.new(h * c[1], h * c[2], h * c[3]) * CFrame.Angles(0, rng:NextNumber(0, math.pi), st.round and 0 or rng:NextNumber(-0.2, 0.2)), color = col, material = st.round and Enum.Material.SmoothPlastic or Enum.Material.Grass })
	end
	return base
end

PIECES.buisson = function(m, st, o)
	local s = o.taille or 3
	local rng = Random.new(o.graine or 3)
	local base
	for i = 1, 4 do
		local d = s * rng:NextNumber(0.55, 0.85)
		local p = newPart(m, "Buisson", { shape = st.round and "Ball" or "Block", size = Vector3.new(d, d * 0.85, d), cf = CFrame.new(rng:NextNumber(-s * 0.3, s * 0.3), d * 0.38, rng:NextNumber(-s * 0.3, s * 0.3)) * CFrame.Angles(0, rng:NextNumber(0, math.pi), 0), color = i % 2 == 0 and st.feuilleFonce or st.feuille, material = st.round and Enum.Material.SmoothPlastic or Enum.Material.Grass })
		base = base or p
	end
	return base
end

PIECES.rocher = function(m, st, o)
	-- Amas irrégulier : un bloc principal facetté (coins coupés) + blocs secondaires inclinés.
	local s = o.taille or 5
	local rng = Random.new(o.graine or 11)
	local tone = st.round and Color3.fromRGB(150, 146, 138) or Color3.fromRGB(118, 114, 106)
	local base = newPart(m, "Rocher", { size = Vector3.new(s, s * 0.62, s * 0.82), cf = CFrame.new(0, s * 0.26, 0) * CFrame.Angles(0.12, rng:NextNumber(0, math.pi), 0.1), color = tone, material = st.stone })
	newPart(m, "Rocher", { size = Vector3.new(s * 0.7, s * 0.45, s * 0.6), cf = CFrame.new(s * 0.12, s * 0.55, -s * 0.05) * CFrame.Angles(-0.2, rng:NextNumber(0, math.pi), 0.25), color = shade(tone, 1.06), material = st.stone })
	for i = 1, 5 do
		local k = rng:NextNumber(0.3, 0.55)
		local size = Vector3.new(s * k, s * k * rng:NextNumber(0.5, 0.8), s * k * rng:NextNumber(0.6, 0.9))
		local a = rng:NextNumber(0, math.pi * 2)
		newPart(m, "Rocher", { size = size, cf = CFrame.new(math.cos(a) * s * 0.55, size.Y * 0.3, math.sin(a) * s * 0.5) * CFrame.Angles(rng:NextNumber(-0.5, 0.5), rng:NextNumber(0, math.pi), rng:NextNumber(-0.5, 0.5)), color = shade(tone, rng:NextNumber(0.85, 1.05)), material = st.stone })
	end
	return base
end

PIECES.barriere = function(m, st, o)
	local l = o.longueur or 8
	local base = newPart(m, "Poteau", { size = Vector3.new(0.6, 3.2, 0.6), cf = CFrame.new(-l / 2, 1.6, 0), color = st.bois, material = st.wood })
	newPart(m, "Poteau", { size = Vector3.new(0.6, 3.2, 0.6), cf = CFrame.new(l / 2, 1.6, 0), color = st.bois, material = st.wood })
	newPart(m, "Poteau", { size = Vector3.new(0.5, 3, 0.5), cf = CFrame.new(0, 1.5, 0), color = st.bois, material = st.wood })
	for _, y in ipairs({ 1.1, 2.4 }) do
		newPart(m, "Traverse", { size = Vector3.new(l, 0.4, 0.25), cf = CFrame.new(0, y, 0.25), color = shade(st.bois, 0.92), material = st.wood })
	end
	for _, x in ipairs({ -l / 2, l / 2 }) do
		newPart(m, "Chapeau", { size = Vector3.new(0.75, 0.2, 0.75), cf = CFrame.new(x, 3.3, 0), color = shade(st.bois, 0.8), material = st.wood })
	end
	return base
end

PIECES.banc = function(m, st, o)
	local l = o.longueur or 6
	local base
	for _, x in ipairs({ -l / 2 + 0.6, l / 2 - 0.6 }) do
		local p = newPart(m, "Pied", { size = Vector3.new(0.4, 1.6, 1.6), cf = CFrame.new(x, 0.8, 0), color = st.metalC, material = st.metal })
		base = base or p
	end
	for i = -1, 1 do
		newPart(m, "Latte", { size = Vector3.new(l, 0.22, 0.5), cf = CFrame.new(0, 1.7, i * 0.56), color = i == 0 and st.bois or shade(st.bois, 0.93), material = st.wood })
	end
	-- Montants arrière qui portent le dossier (rien ne flotte).
	for _, x in ipairs({ -l / 2 + 0.6, l / 2 - 0.6 }) do
		newPart(m, "Montant", { size = Vector3.new(0.3, 2.1, 0.3), cf = CFrame.new(x, 2.55, 0.85) * CFrame.Angles(math.rad(-12), 0, 0), color = st.metalC, material = st.metal })
	end
	for i = 0, 1 do
		newPart(m, "Dossier", { size = Vector3.new(l, 0.45, 0.2), cf = CFrame.new(0, 2.4 + i * 0.6, 0.9 + i * 0.13) * CFrame.Angles(math.rad(-12), 0, 0), color = st.bois, material = st.wood })
	end
	return base
end

PIECES.auvent = function(m, st, o)
	local l, p = o.longueur or 8, o.profondeur or 4
	local bands = math.max(4, math.floor(l / 1.2))
	local base
	for i = 0, bands - 1 do
		local w = l / bands
		local col = i % 2 == 0 and color3(o.couleur, st.accent) or st.accent2
		local part = newPart(m, "Toile", { shape = "Wedge", size = Vector3.new(w, 1.2, p), cf = CFrame.new(-l / 2 + w * (i + 0.5), 0.6, 0) * CFrame.Angles(0, math.rad(180), 0), color = col, material = st.cloth })
		newPart(m, "Festons", { shape = st.round and "Cylinder" or "Block", size = st.round and Vector3.new(w * 0.98, 0.55, 0.55) or Vector3.new(w * 0.98, 0.5, 0.2), cf = CFrame.new(-l / 2 + w * (i + 0.5), -0.05, -p / 2) * (st.round and CFrame.Angles(0, 0, 0) or CFrame.new()), color = col, material = st.cloth })
		base = base or part
	end
	return base
end

PIECES.etal = function(m, st, o)
	local l = o.longueur or 9
	local base = beveledBlock(m, "Comptoir", Vector3.new(l, 3, 3), CFrame.new(0, 1.5, 0), st.bois, st.wood, st, 0.25)
	newPart(m, "Plateau", { size = Vector3.new(l + 0.4, 0.3, 3.4), cf = CFrame.new(0, 3.15, 0), color = shade(st.bois, 0.85), material = st.wood })
	-- Façade : lattes verticales, plinthe et bandeau (le détail qui fait « pro »).
	local slats = math.floor(l / 0.9)
	for i = 0, slats - 1 do
		newPart(m, "Latte", { size = Vector3.new(l / slats - 0.12, 2.3, 0.14), cf = CFrame.new(-l / 2 + (i + 0.5) * l / slats, 1.6, -1.57), color = i % 2 == 0 and shade(st.bois, 1.05) or shade(st.bois, 0.95), material = st.wood })
	end
	newPart(m, "Plinthe", { size = Vector3.new(l + 0.1, 0.35, 3.2), cf = CFrame.new(0, 0.175, 0), color = shade(st.bois, 0.7), material = st.wood })
	newPart(m, "Bandeau", { size = Vector3.new(l + 0.1, 0.3, 0.2), cf = CFrame.new(0, 2.85, -1.62), color = color3(o.couleur, st.accent), material = st.cloth })
	-- Poteaux juste à l'extérieur du comptoir (pas enfouis dedans).
	for _, x in ipairs({ -l / 2 + 0.3, l / 2 - 0.3 }) do
		for _, z in ipairs({ -1.78, 1.78 }) do
			newPart(m, "Poteau", { size = Vector3.new(0.45, 8, 0.45), cf = CFrame.new(x, 4, z), color = shade(st.bois, 0.8), material = st.wood })
		end
	end
	local aw = Instance.new("Model")
	aw.Name = "Auvent"
	aw.Parent = m
	PIECES.auvent(aw, st, { longueur = l + 1, profondeur = 4.2, couleur = o.couleur })
	aw:PivotTo(CFrame.new(0, 8.4, -0.2))
	local rng = Random.new(5)
	for i = 1, 3 do
		local crate = Instance.new("Model")
		crate.Name = "Caisse"
		crate.Parent = m
		PIECES.caisse(crate, st, { taille = 1.3 })
		crate:PivotTo(CFrame.new(-l / 2 + 1.5 + (i - 1) * (l - 3) / 2, 3.3, -0.3) * CFrame.Angles(0, rng:NextNumber(-0.2, 0.2), 0))
		local fruitColor = ({ Color3.fromRGB(230, 60, 50), Color3.fromRGB(255, 170, 40), Color3.fromRGB(120, 200, 70) })[i]
		for k = 1, 4 do
			newPart(crate, "Fruit", { shape = "Ball", size = Vector3.new(0.7, 0.7, 0.7), cf = CFrame.new(-l / 2 + 1.5 + (i - 1) * (l - 3) / 2 + (k % 2 - 0.5) * 0.5, 4.75, -0.3 + (k > 2 and 0.25 or -0.25)), color = fruitColor, collide = false })
		end
	end
	return base
end

PIECES.panneau = function(m, st, o)
	local base = newPart(m, "Poteau", { size = Vector3.new(0.5, 5, 0.5), cf = CFrame.new(0, 2.5, 0), color = st.boisFonce, material = st.wood })
	local board = beveledBlock(m, "Planche", Vector3.new(5, 2.2, 0.4), CFrame.new(0, 4.6, 0.1), st.bois, st.wood, st, 0.12)
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.PixelsPerStud = 60
	gui.Parent = board
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(0.92, 0.8)
	label.Position = UDim2.fromScale(0.04, 0.1)
	label.BackgroundTransparency = 1
	label.Text = o.texte or "Fruits"
	label.TextScaled = true
	label.Font = Enum.Font.FredokaOne
	label.TextColor3 = st.accent2
	label.Parent = gui
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 3
	stroke.Color = shade(st.boisFonce, 0.7)
	stroke.Parent = label
	return base
end

PIECES.plateforme = function(m, st, o)
	local r, n = o.rayon or 12, o.cotes or 8
	local base = newPart(m, "Sol", { shape = "Cylinder", size = Vector3.new(1, r * 2, r * 2), cf = CFrame.new(0, 0.5, 0) * CFrame.Angles(0, 0, math.rad(90)), color = st.pierre, material = st.stone })
	for i = 0, n - 1 do
		local a = (i / n) * math.pi * 2
		local seg = 2 * r * math.sin(math.pi / n) + 0.3
		newPart(m, "Bordure", { size = Vector3.new(seg, 0.8, 1), cf = CFrame.new(math.cos(a) * (r - 0.4), 1.1, math.sin(a) * (r - 0.4)) * CFrame.Angles(0, -a + math.pi / 2, 0), color = shade(st.pierre, 0.8), material = st.stone })
	end
	return base
end

PIECES.escalier = function(m, st, o)
	local marches, l = o.marches or 6, o.largeur or 6
	local base
	for i = 0, marches - 1 do
		local p = beveledBlock(m, "Marche", Vector3.new(l, 0.8 * (i + 1), 1.6), CFrame.new(0, 0.4 * (i + 1), -i * 1.6), i % 2 == 0 and st.pierre or shade(st.pierre, 0.92), st.stone, st, 0.12)
		base = base or p
	end
	return base
end

PIECES.arche = function(m, st, o)
	local w, h = o.largeur or 10, o.hauteur or 10
	local base = beveledBlock(m, "Pilier", Vector3.new(1.8, h, 1.8), CFrame.new(-w / 2, h / 2, 0), st.pierre, st.stone, st, 0.2)
	beveledBlock(m, "Pilier", Vector3.new(1.8, h, 1.8), CFrame.new(w / 2, h / 2, 0), st.pierre, st.stone, st, 0.2)
	local n = 9
	for i = 0, n - 1 do
		local a = math.pi * (i + 0.5) / n
		newPart(m, "Claveau", { size = Vector3.new(1.9, w * math.pi / 2 / n + 0.15, 1.9), cf = CFrame.new(math.cos(a) * w / 2, h + math.sin(a) * w / 2 * 0.6, 0) * CFrame.Angles(0, 0, a), color = i % 2 == 0 and st.pierre or shade(st.pierre, 0.9), material = st.stone })
	end
	return base
end

handlers.kit_piece = function(args)
	local kind = args.type
	local build = PIECES[kind]
	if not build then
		local names = {}
		for k in pairs(PIECES) do table.insert(names, k) end
		table.sort(names)
		error("Pièce inconnue « " .. tostring(kind) .. " ». Pièces : " .. table.concat(names, ", "))
	end
	local st = table.clone(STYLES[args.style] or STYLES.simulator)
	local palette = args.palette or {}
	st.bois = color3(palette.bois, st.bois)
	st.pierre = color3(palette.pierre, st.pierre)
	st.feuille = color3(palette.feuille, st.feuille)
	st.accent = color3(palette.accent, st.accent)
	st.accent2 = color3(palette.accent2, st.accent2)
	local recording = ChangeHistoryService:TryBeginRecording("RoForge kit")
	local model = Instance.new("Model")
	model.Name = args.nom or (kind:sub(1, 1):upper() .. kind:sub(2))
	local base = build(model, st, args.options or {})
	model.PrimaryPart = base
	-- Pivot droit au centre du dessous du modèle (même si la pièce de base est un cylindre tourné).
	local cf0, size0 = boundsOf(model)
	base.PivotOffset = base.CFrame:ToObjectSpace(CFrame.new(cf0.Position - Vector3.new(0, size0.Y / 2, 0)))
	local parent = args.parent and resolve(args.parent) or workspace
	model.Parent = parent
	-- Posé au sol à la position demandée, tourné de « rotation » degrés.
	local pos = args.position and Vector3.new(args.position[1], args.position[2] or 0, args.position[3]) or Vector3.new(0, 0, 0)
	local rp = RaycastParams.new()
	rp.FilterType = Enum.RaycastFilterType.Exclude
	rp.FilterDescendantsInstances = { model }
	local hit = workspace:Raycast(pos + Vector3.new(0, 200, 0), Vector3.new(0, -400, 0), rp)
	local groundY = hit and hit.Position.Y or pos.Y
	local size = size0
	model:PivotTo(CFrame.new(pos.X, groundY, pos.Z) * CFrame.Angles(0, math.rad(args.rotation or 0), 0))
	if recording then ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit) end
	local count = 0
	for _, d in ipairs(model:GetDescendants()) do if d:IsA("BasePart") then count += 1 end end
	return { chemin = model:GetFullName(), pieces = count, taille = { size.X, size.Y, size.Z } }
end

---------------------------------------------------------------------------
-- Ambiance (éclairage) — préréglages pro, Bloom faible, jamais « tout brille »
---------------------------------------------------------------------------
local AMBIANCES = {
	simulator = { ClockTime = 14, Brightness = 2.6, Ambient = "#8A8F9E", OutdoorAmbient = "#9FA8C0", ExposureCompensation = 0.1, atmo = { Density = 0.22, Haze = 0.6, Color = "#C7DDF2", Decay = "#9DB7D6", Glare = 0.1 }, cc = { Saturation = 0.12, Contrast = 0.06, Brightness = 0.02, TintColor = "#FFFFFF" }, bloom = { Intensity = 0.25, Size = 22, Threshold = 1.8 } },
	realiste = { ClockTime = 13, Brightness = 2.2, Ambient = "#6E6A64", OutdoorAmbient = "#7F858F", ExposureCompensation = 0, atmo = { Density = 0.3, Haze = 1.2, Color = "#C9D3DD", Decay = "#A0A4AA", Glare = 0.2 }, cc = { Saturation = -0.05, Contrast = 0.08, Brightness = 0, TintColor = "#FFF8F0" }, bloom = { Intensity = 0.15, Size = 18, Threshold = 2 } },
	coucher = { ClockTime = 17.8, Brightness = 2, Ambient = "#7A5E57", OutdoorAmbient = "#8C6E66", ExposureCompensation = 0.15, atmo = { Density = 0.35, Haze = 1.6, Color = "#F2B88C", Decay = "#B5707A", Glare = 0.6 }, cc = { Saturation = 0.1, Contrast = 0.08, Brightness = 0, TintColor = "#FFE6D2" }, bloom = { Intensity = 0.3, Size = 26, Threshold = 1.6 } },
	nuit = { ClockTime = 0.5, Brightness = 1, Ambient = "#3A4260", OutdoorAmbient = "#465276", ExposureCompensation = 0.3, atmo = { Density = 0.32, Haze = 1, Color = "#5D6E99", Decay = "#2C3552", Glare = 0 }, cc = { Saturation = -0.05, Contrast = 0.1, Brightness = 0.03, TintColor = "#DDE6FF" }, bloom = { Intensity = 0.3, Size = 24, Threshold = 1.5 } },
	foret = { ClockTime = 15, Brightness = 1.8, Ambient = "#5F6B55", OutdoorAmbient = "#6F7C63", ExposureCompensation = 0.05, atmo = { Density = 0.42, Haze = 2, Color = "#B9CCAA", Decay = "#7E9A72", Glare = 0.15 }, cc = { Saturation = 0.05, Contrast = 0.07, Brightness = 0, TintColor = "#F4FFEA" }, bloom = { Intensity = 0.18, Size = 20, Threshold = 2 } },
	interieur = { ClockTime = 12, Brightness = 1.2, Ambient = "#7C7470", OutdoorAmbient = "#6C6A6A", ExposureCompensation = 0.1, atmo = { Density = 0.05, Haze = 0, Color = "#D8D2C8", Decay = "#B0A89C", Glare = 0 }, cc = { Saturation = 0, Contrast = 0.05, Brightness = 0.02, TintColor = "#FFF5E8" }, bloom = { Intensity = 0.2, Size = 18, Threshold = 2 } },
}

local function ensure(className, name)
	local inst = Lighting:FindFirstChildOfClass(className)
	if not inst then
		inst = Instance.new(className)
		inst.Name = name or className
		inst.Parent = Lighting
	end
	return inst
end

handlers.ambiance = function(args)
	local preset = AMBIANCES[args.preset or "simulator"]
	if not preset then
		local names = {}
		for k in pairs(AMBIANCES) do table.insert(names, k) end
		table.sort(names)
		error("Ambiance inconnue. Choix : " .. table.concat(names, ", "))
	end
	local recording = ChangeHistoryService:TryBeginRecording("RoForge ambiance")
	pcall(function() Lighting.Technology = Enum.Technology.Future end)
	Lighting.ClockTime = preset.ClockTime
	Lighting.Brightness = preset.Brightness
	Lighting.Ambient = Color3.fromHex(preset.Ambient)
	Lighting.OutdoorAmbient = Color3.fromHex(preset.OutdoorAmbient)
	Lighting.ExposureCompensation = preset.ExposureCompensation
	Lighting.GlobalShadows = true
	pcall(function() Lighting.ShadowSoftness = 0.25 end)
	Lighting.EnvironmentDiffuseScale = 1
	Lighting.EnvironmentSpecularScale = 1
	local atmo = ensure("Atmosphere")
	for k, v in pairs(preset.atmo) do atmo[k] = type(v) == "string" and Color3.fromHex(v) or v end
	local cc = ensure("ColorCorrectionEffect", "Correction")
	for k, v in pairs(preset.cc) do cc[k] = type(v) == "string" and Color3.fromHex(v) or v end
	local bloom = ensure("BloomEffect", "Bloom")
	for k, v in pairs(preset.bloom) do bloom[k] = v end
	local rays = ensure("SunRaysEffect", "Rayons")
	rays.Intensity = 0.04
	rays.Spread = 0.6
	if recording then ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit) end
	return "Ambiance « " .. (args.preset or "simulator") .. " » appliquée (Future, Atmosphere, ColorCorrection, Bloom faible)."
end

---------------------------------------------------------------------------
-- VFX : émetteurs de particules propres (textures intégrées à Roblox, pas de Toolbox)
---------------------------------------------------------------------------
local TEX = { smoke = "rbxasset://textures/particles/smoke_main.dds", spark = "rbxasset://textures/particles/sparkles_main.dds", fire = "rbxasset://textures/particles/fire_main.dds", star = "rbxasset://textures/particles/explosion01_core_main.dds" }

local function cs(...)
	local pts = { ... }
	local kp = {}
	for i, c in ipairs(pts) do table.insert(kp, ColorSequenceKeypoint.new((i - 1) / math.max(1, #pts - 1), color3(c, Color3.new(1, 1, 1)))) end
	return ColorSequence.new(kp)
end
local function ns(...)
	local pts = { ... }
	local kp = {}
	for i = 1, #pts, 2 do table.insert(kp, NumberSequenceKeypoint.new(pts[i], pts[i + 1])) end
	return NumberSequence.new(kp)
end

local VFX = {
	poussiere = { { Texture = TEX.smoke, Color = cs("#D9CBB2", "#BFAE90"), Size = ns(0, 0.8, 1, 2.4), Transparency = ns(0, 0.55, 1, 1), Lifetime = NumberRange.new(0.6, 1.1), Speed = NumberRange.new(4, 8), SpreadAngle = Vector2.new(80, 80), Acceleration = Vector3.new(0, 2, 0), Drag = 4, Rate = 0, burst = 18 } },
	impact = {
		{ Texture = TEX.spark, Color = cs("#FFFFFF", "#FFD27A"), Size = ns(0, 0.5, 1, 0), Transparency = ns(0, 0, 1, 1), Lifetime = NumberRange.new(0.2, 0.4), Speed = NumberRange.new(18, 30), SpreadAngle = Vector2.new(180, 180), Drag = 6, Rate = 0, burst = 24 },
		{ Texture = TEX.smoke, Color = cs("#E8E2D8", "#B9B2A6"), Size = ns(0, 1, 1, 3), Transparency = ns(0, 0.5, 1, 1), Lifetime = NumberRange.new(0.4, 0.7), Speed = NumberRange.new(3, 6), SpreadAngle = Vector2.new(180, 180), Drag = 5, Rate = 0, burst = 8 },
	},
	etincelles = { { Texture = TEX.spark, Color = cs("#FFF4D6", "#FFB347"), LightEmission = 0.4, Size = ns(0, 0.25, 1, 0), Transparency = ns(0, 0, 1, 0.6), Lifetime = NumberRange.new(0.3, 0.6), Speed = NumberRange.new(10, 18), SpreadAngle = Vector2.new(35, 35), Acceleration = Vector3.new(0, -30, 0), Rate = 0, burst = 20 } },
	fumee = { { Texture = TEX.smoke, Color = cs("#9A9A9A", "#6E6E6E"), Size = ns(0, 1.5, 1, 5), Transparency = ns(0, 0.6, 1, 1), Lifetime = NumberRange.new(2, 3.5), Speed = NumberRange.new(1.5, 3), SpreadAngle = Vector2.new(15, 15), Acceleration = Vector3.new(0.5, 1.5, 0), RotSpeed = NumberRange.new(-20, 20), Rate = 6 } },
	pieces = { { Texture = TEX.spark, Color = cs("#FFE27A", "#F2B233"), Size = ns(0, 0.45, 1, 0.2), Transparency = ns(0, 0, 0.8, 0, 1, 1), Lifetime = NumberRange.new(0.6, 0.9), Speed = NumberRange.new(10, 16), SpreadAngle = Vector2.new(50, 50), Acceleration = Vector3.new(0, -35, 0), Rate = 0, burst = 16 } },
	soin = { { Texture = TEX.spark, Color = cs("#B8FFC9", "#5BD982"), Size = ns(0, 0.35, 1, 0), Transparency = ns(0, 0.2, 1, 1), Lifetime = NumberRange.new(0.8, 1.2), Speed = NumberRange.new(1, 3), SpreadAngle = Vector2.new(180, 180), Acceleration = Vector3.new(0, 6, 0), Rate = 14 } },
	niveau = {
		{ Texture = TEX.spark, Color = cs("#FFFFFF", "#FFE08A"), Size = ns(0, 0.5, 1, 0), Transparency = ns(0, 0, 1, 1), Lifetime = NumberRange.new(0.6, 1), Speed = NumberRange.new(8, 14), SpreadAngle = Vector2.new(20, 180), Acceleration = Vector3.new(0, 10, 0), Rate = 0, burst = 30 },
		{ Texture = TEX.smoke, Color = cs("#FFF3C4", "#FFFFFF"), Size = ns(0, 2, 1, 5), Transparency = ns(0, 0.7, 1, 1), Lifetime = NumberRange.new(0.5, 0.8), Speed = NumberRange.new(0, 1), Rate = 0, burst = 3 },
	},
	aura = { { Texture = TEX.spark, Color = cs("#FFFFFF", "#CFE3FF"), Size = ns(0, 0.3, 0.5, 0.45, 1, 0), Transparency = ns(0, 0.4, 1, 1), Lifetime = NumberRange.new(0.8, 1.4), Speed = NumberRange.new(0.5, 1.5), SpreadAngle = Vector2.new(180, 180), Acceleration = Vector3.new(0, 3, 0), Rate = 10 } },
}

handlers.kit_vfx = function(args)
	local layers = VFX[args.type]
	if not layers then
		local names = {}
		for k in pairs(VFX) do table.insert(names, k) end
		table.sort(names)
		error("Effet inconnu. Choix : " .. table.concat(names, ", "))
	end
	local target = resolve(args.cible)
	local part = target:IsA("BasePart") and target or (target:IsA("Model") and (target.PrimaryPart or target:FindFirstChildWhichIsA("BasePart", true)))
	if not part then error("La cible doit être une pièce ou un modèle avec des pièces") end
	local tint = args.couleur and color3(args.couleur, nil)
	local att = Instance.new("Attachment")
	att.Name = "VFX_" .. args.type
	att.Parent = part
	local emitters = {}
	for i, layer in ipairs(layers) do
		local e = Instance.new("ParticleEmitter")
		e.Name = ("%s_%d"):format(args.type, i)
		for k, v in pairs(layer) do
			if k ~= "burst" then e[k] = v end
		end
		if tint then e.Color = ColorSequence.new(tint) end
		e.LightEmission = math.min(e.LightEmission, 0.5) -- pas de lueur néon
		if layer.burst then
			e.Enabled = false
			e:SetAttribute("Rafale", layer.burst)
		end
		e.Parent = att
		table.insert(emitters, e.Name)
	end
	return {
		attachment = att:GetFullName(),
		emetteurs = emitters,
		usage = "Effets en rafale : pour chaque ParticleEmitter, appelle emitter:Emit(emitter:GetAttribute(\"Rafale\")) au bon moment (côté client de préférence). Effets continus : Enabled = true/false.",
	}
end

---------------------------------------------------------------------------
-- Modèles IA (generate_mesh du MCP officiel) : repérage du résultat, finition, accessoire
---------------------------------------------------------------------------
local meshMarks = {}

-- Retient les enfants actuels du Workspace pour retrouver ce que la génération va ajouter.
handlers.mesh_mark = function()
	meshMarks = {}
	for _, c in ipairs(workspace:GetChildren()) do meshMarks[c] = true end
	return true
end

local function newestGenerated()
	local found = {}
	for _, c in ipairs(workspace:GetChildren()) do
		if not meshMarks[c] and (c:IsA("Model") or c:IsA("MeshPart")) and c.Name ~= "RoForgeSolStudio" then table.insert(found, c) end
	end
	return found
end

-- Renomme, range, pose au sol, ancre et fixe le pivot du modèle généré.
handlers.mesh_finish = function(args)
	local inst = args.path and resolve(args.path) or newestGenerated()[1]
	if not inst then error("Aucun modèle généré trouvé dans le Workspace") end
	local recording = ChangeHistoryService:TryBeginRecording("RoForge modèle IA")
	local model = inst
	if inst:IsA("BasePart") then
		model = Instance.new("Model")
		inst.Parent = model
		model.Parent = workspace
	end
	model.Name = args.nom or "ModeleIA"
	local main, biggest = nil, -1
	for _, d in ipairs(model:GetDescendants()) do
		if d:IsA("BasePart") then
			d.Anchored = true
			if d:IsA("MeshPart") then d.Material = d.Material == Enum.Material.Neon and Enum.Material.SmoothPlastic or d.Material end
			local v = d.Size.X * d.Size.Y * d.Size.Z
			if v > biggest then main, biggest = d, v end
		end
	end
	if not main then error("Le modèle généré ne contient aucune pièce") end
	-- Textures chargées avant les captures (sinon la planche montre un modèle gris).
	pcall(function() game:GetService("ContentProvider"):PreloadAsync({ model }) end)
	model.PrimaryPart = main
	local cf0, size0 = boundsOf(model)
	main.PivotOffset = main.CFrame:ToObjectSpace(CFrame.new(cf0.Position - Vector3.new(0, size0.Y / 2, 0)))
	if args.parent then model.Parent = resolve(args.parent) end
	if args.position then
		local pos = Vector3.new(args.position[1], args.position[2] or 0, args.position[3])
		local rp = RaycastParams.new()
		rp.FilterType = Enum.RaycastFilterType.Exclude
		rp.FilterDescendantsInstances = { model }
		local hit = workspace:Raycast(pos + Vector3.new(0, 200, 0), Vector3.new(0, -400, 0), rp)
		model:PivotTo(CFrame.new(pos.X, hit and hit.Position.Y or pos.Y, pos.Z) * CFrame.Angles(0, math.rad(args.rotation or 0), 0))
	end
	if recording then ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit) end
	local count, meshes = 0, 0
	for _, d in ipairs(model:GetDescendants()) do
		if d:IsA("BasePart") then count += 1 end
		if d:IsA("MeshPart") then meshes += 1 end
	end
	return { chemin = model:GetFullName(), pieces = count, maillages = meshes, taille = { size0.X, size0.Y, size0.Z } }
end

-- Point d'accroche de l'accessoire sur la tête / le corps, en fraction de hauteur depuis le bas.
local ACCESSORY_SLOTS = {
	chapeau = { "HatAttachment", 0.42 },
	cheveux = { "HairAttachment", 0.72 },
	visage = { "FaceFrontAttachment", 0.5 },
	cou = { "NeckAttachment", 0.5 },
	dos = { "BodyBackAttachment", 0.5 },
	taille = { "WaistCenterAttachment", 0.5 },
	epaule = { "LeftShoulderAttachment", 0.3 },
}

-- Transforme un modèle en Accessory portable (Handle soudé, attachement au bon endroit).
handlers.mesh_accessory = function(args)
	local model = resolve(args.path)
	local slot = ACCESSORY_SLOTS[args.type or "chapeau"]
	if not slot then error("Type d'accessoire inconnu : chapeau, cheveux, visage, cou, dos, taille, epaule") end
	local recording = ChangeHistoryService:TryBeginRecording("RoForge accessoire")
	local handle = model:IsA("Model") and model.PrimaryPart or model
	local cf, size = boundsOf(model)
	local acc = Instance.new("Accessory")
	acc.Name = model.Name
	acc.AccessoryType = args.type == "cheveux" and Enum.AccessoryType.Hair or args.type == "chapeau" and Enum.AccessoryType.Hat or Enum.AccessoryType.Unknown
	for _, d in ipairs(model:GetDescendants()) do
		if d:IsA("BasePart") then
			d.Anchored = false
			d.CanCollide = false
			d.CanTouch = false
			d.CanQuery = false
			d.Massless = true
			if d ~= handle then
				local w = Instance.new("WeldConstraint")
				w.Part0, w.Part1 = handle, d
				w.Parent = d
				d.Parent = handle
			end
		end
	end
	handle.Name = "Handle"
	local att = Instance.new("Attachment")
	att.Name = slot[1]
	att.Parent = handle
	att.WorldCFrame = CFrame.new(cf.Position - Vector3.new(0, size.Y / 2, 0) + Vector3.new(0, size.Y * slot[2], 0)) * (cf - cf.Position)
	handle.Parent = acc
	local folder
	if args.parent then
		folder = resolve(args.parent)
	else
		local rs = game:GetService("ReplicatedStorage")
		folder = rs:FindFirstChild("Accessoires") or Instance.new("Folder")
		folder.Name = "Accessoires"
		folder.Parent = rs
	end
	acc.Parent = folder
	if model ~= handle then model:Destroy() end
	if recording then ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit) end
	return {
		chemin = acc:GetFullName(),
		attachement = slot[1],
		usage = "Côté serveur : humanoid:AddAccessory(accessoire:Clone()). Ajuste " .. slot[1] .. ".Position si l'accessoire est trop haut / bas sur la tête.",
	}
end

---------------------------------------------------------------------------
-- Import d'un maillage Blender (OBJ lu par l'app) : EditableMesh → asset Mesh publié → MeshPart
---------------------------------------------------------------------------
handlers.mesh_import = function(args)
	local AssetService = game:GetService("AssetService")
	local em = AssetService:CreateEditableMesh()
	local verts, uvs, faces, fuv, fcol = args.v or {}, args.uv or {}, args.f or {}, args.fuv, args.fc
	local vid, uid, cid = {}, {}, {}
	for i = 1, #verts, 3 do vid[#vid + 1] = em:AddVertex(Vector3.new(verts[i], verts[i + 1], verts[i + 2])) end
	for i = 1, #uvs, 2 do uid[#uid + 1] = em:AddUV(Vector2.new(uvs[i], 1 - uvs[i + 1])) end
	for i, c in ipairs(args.couleurs or {}) do cid[i] = em:AddColor(Color3.fromRGB(c[1], c[2], c[3]), 1) end
	local tris = 0
	for t = 1, #faces, 3 do
		local a, b, c = vid[faces[t]], vid[faces[t + 1]], vid[faces[t + 2]]
		if a and b and c and a ~= b and b ~= c and a ~= c then
			local face = em:AddTriangle(a, b, c)
			tris += 1
			if fuv and fuv[t] and uid[fuv[t]] then pcall(em.SetFaceUVs, em, face, { uid[fuv[t]], uid[fuv[t + 1]], uid[fuv[t + 2]] }) end
			local col = fcol and cid[fcol[(t + 2) // 3]]
			if col then pcall(em.SetFaceColors, em, face, { col, col, col }) end
		end
	end
	-- Normales lissées selon l'angle (rendu propre des biseaux) si l'API le permet.
	pcall(function() em:RemoveUnused() end)
	local recording = ChangeHistoryService:TryBeginRecording("RoForge import Blender")
	-- Publication du maillage : l'objet reste dans la place après sauvegarde.
	local assetId, published = nil, false
	local okPub, err = pcall(function()
		local result, id = AssetService:CreateAssetAsync(em, Enum.AssetType.Mesh, { Name = args.nom or "ModeleBlender", Description = "Importé par RoForge depuis Blender" })
		if result == Enum.CreateAssetResult.Success then assetId, published = id, true else error(tostring(result)) end
	end)
	local part
	if published then
		part = AssetService:CreateMeshPartAsync(Content.fromUri("rbxassetid://" .. assetId))
	else
		part = AssetService:CreateMeshPartAsync(Content.fromObject(em))
	end
	part.Name = args.nom or "ModeleBlender"
	part.Anchored = true
	part.Material = Enum.Material.SmoothPlastic
	if args.texture then part.TextureID = args.texture end
	if not args.couleurs or #args.couleurs == 0 then part.Color = Color3.fromRGB(200, 200, 200) end
	local model = Instance.new("Model")
	model.Name = args.nom or "ModeleBlender"
	part.Parent = model
	model.PrimaryPart = part
	local cf, size = boundsOf(model)
	part.PivotOffset = part.CFrame:ToObjectSpace(CFrame.new(cf.Position - Vector3.new(0, size.Y / 2, 0)))
	model.Parent = args.parent and resolve(args.parent) or workspace
	if args.position then
		local pos = Vector3.new(args.position[1], args.position[2] or 0, args.position[3])
		local rp = RaycastParams.new()
		rp.FilterType = Enum.RaycastFilterType.Exclude
		rp.FilterDescendantsInstances = { model }
		local hit = workspace:Raycast(pos + Vector3.new(0, 200, 0), Vector3.new(0, -400, 0), rp)
		model:PivotTo(CFrame.new(pos.X, hit and hit.Position.Y or pos.Y, pos.Z))
	end
	if recording then ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit) end
	return {
		chemin = model:GetFullName(), triangles = tris, sommets = #vid, publie = published, asset = assetId,
		avertissement = (not published) and ("Maillage non publié (" .. tostring(err) .. ") : il s'affiche mais ne sera pas gardé à la sauvegarde. Connecte Studio à ton compte et réimporte.") or nil,
	}
end
